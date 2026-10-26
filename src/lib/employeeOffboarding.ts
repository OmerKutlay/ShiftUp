/**
 * employeeOffboarding — işten ayrılış önizlemesi ve uygulaması (yalnızca server).
 *
 * Önizleme (preview) hiçbir şey değiştirmez. Uygulama TÜM veritabanı yazmalarını tek bir
 * Postgres fonksiyonunda (apply_employee_offboarding, tek transaction) yapar; hata olursa hiçbir
 * şey değişmez. TS tarafı yalnızca hesaplar (izin bakiyesi), RPC'yi çağırır ve başarıdan sonra
 * bildirim gönderir.
 *   - son çalışma gününden SONRAKİ vardiyalar (tüm mağazalarda) silinir; yalnızca bugün ve sonrası
 *     (izinli olmayan) vardiyalar açık vardiyaya çevrilebilir
 *   - giriş/çıkış kaydı olan vardiya ASLA silinmez (attendance CASCADE): varsa işlem reddedilir
 *   - bekleyen izin / mesai düzeltme / takas talepleri iptal edilir (karşı taraf bildirilir)
 *   - son çalışma gününden sonra başlayan onaylı izinler iptal edilir
 * Hesap aktifliği (`active`) için bkz. src/lib/employment.ts ve apply_employee_terminations() cron'u.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAnnualLeaveBalance, type AnnualLeaveBalance } from '@/lib/annualLeave'
import { addDaysToDateString, turkeyToday } from '@/lib/dateUtils'
import { fetchHolidaysInRange } from '@/lib/holidayRepository'
import { createNotifications } from '@/lib/notificationRepository'
import { isValidDate } from '@/lib/validation'
import { MAX_BACKDATE_DAYS, MAX_FUTURE_DAYS } from '@/lib/offboardingLimits'

export { MAX_BACKDATE_DAYS, MAX_FUTURE_DAYS }

/**
 * Yıllık izin bakiyesi kapsamı. Md. 59 biriken tüm kullanılmamış izni kapsar; ancak uygulamada
 * yalnızca uygulamaya girilmiş izinler bilinir (eski dönemlerin kullanımı kayıtlı olmayabilir), bu yüzden
 * yalnızca içinde bulunulan hizmet yılının hakkı hesaplanır. Bordro ile doğrulanmalıdır.
 */
export const LEAVE_BALANCE_SCOPE = 'yalnızca içinde bulunulan hizmet yılı'
export const LEAVE_BALANCE_NOTE = 'Yalnızca içinde bulunulan hizmet yılı için hesaplanır; önceki yıllardan devreden izin varsa bordro ile doğrulayın.'

export interface OffboardingShift {
  id: string
  store_id: string
  store_name: string | null
  work_date: string
  start_time: string
  end_time: string
  is_on_leave: boolean
  /** Giriş/çıkış kaydı var: silinemez */
  has_attendance: boolean
  /** Açık vardiyaya çevrilebilir (bugün/sonrası, izinli değil, kaydı yok) */
  can_convert: boolean
}

export interface OffboardingPreview {
  last_day: string
  /** Son gün bugünden önceyse hesap hemen pasifleşir */
  deactivates_now: boolean
  future_shifts: OffboardingShift[]
  /** Son günden sonra giriş/çıkış kaydı olan en erken vardiya günü; doluysa işlem yapılamaz */
  attendance_conflict_date: string | null
  pending_leave: number
  future_approved_leave: number
  pending_time_corrections: number
  pending_swaps: number
  leave_balance: {
    known: boolean
    entitlement_days: number
    used_days: number
    remaining_days: number
    scope: string
    note: string
  }
}

export interface TerminationTarget {
  id: string
  full_name: string
  hire_date: string | null
  birth_date: string | null
  store_id: string
  termination_date: string | null
}

/** Beklenen iş kuralı hatası (HTTP 409 / 404'e çevrilir) */
export class OffboardingError extends Error {
  constructor(public code: 'HAS_ATTENDANCE' | 'ALREADY_TERMINATED' | 'NOT_FOUND', message: string) {
    super(message)
  }
}

export const attendanceConflictMessage = (date: string) =>
  `${date} günü çalışma kaydı var; son iş günü bu tarihten önce olamaz.`

/** Son çalışma günü doğrulaması; hata mesajı ya da null */
export function validateLastDay(lastDay: unknown, hireDate: string | null, today = turkeyToday()): string | null {
  if (!isValidDate(lastDay)) return 'Geçerli bir son çalışma günü girin (YYYY-MM-DD).'
  if (hireDate && lastDay < hireDate) return 'Son çalışma günü işe giriş tarihinden önce olamaz.'
  if (lastDay < addDaysToDateString(today, -MAX_BACKDATE_DAYS)) {
    return `Son çalışma günü en fazla ${MAX_BACKDATE_DAYS} gün öncesine ayarlanabilir.`
  }
  if (lastDay > addDaysToDateString(today, MAX_FUTURE_DAYS)) return 'Son çalışma günü en fazla 1 yıl sonrası olabilir.'
  return null
}

/** Çıkış tarihindeki kullanılmamış yıllık izin (yalnızca onaylı izinler; çıkıştan sonrası sayılmaz) */
export async function computeTerminationLeaveBalance(
  admin: SupabaseClient,
  emp: Pick<TerminationTarget, 'id' | 'hire_date' | 'birth_date' | 'store_id'>,
  lastDay: string
): Promise<AnnualLeaveBalance> {
  const from = addDaysToDateString(lastDay, -370)
  const to = addDaysToDateString(lastDay, 1)
  const [reqRes, holidays] = await Promise.all([
    admin
      .from('leave_requests')
      .select('start_date, end_date, status')
      .eq('employee_id', emp.id)
      .eq('leave_type', 'annual')
      .eq('status', 'approved')
      .lte('start_date', lastDay)
      .gte('end_date', from),
    fetchHolidaysInRange(emp.store_id, from, to),
  ])
  if (reqRes.error) throw reqRes.error
  const requests = ((reqRes.data ?? []) as Array<{ start_date: string; end_date: string; status: 'approved' }>)
    .map((r) => ({ ...r, end_date: r.end_date > lastDay ? lastDay : r.end_date }))
  return computeAnnualLeaveBalance({
    hireDate: emp.hire_date,
    birthDate: emp.birth_date,
    today: lastDay,
    requests,
    fullDayHolidays: new Set(holidays.filter((h) => !h.half_day).map((h) => h.date)),
  })
}

async function loadFutureShifts(
  admin: SupabaseClient, employeeId: string, lastDay: string, today: string
): Promise<OffboardingShift[]> {
  const { data, error } = await admin
    .from('shift_assignments')
    .select('id, store_id, work_date, start_time, end_time, is_on_leave, stores ( name ), attendance_records ( id )')
    .eq('employee_id', employeeId)
    .gt('work_date', lastDay)
    .order('work_date')
    .order('start_time')
  if (error) throw error
  return (data ?? []).map((s) => {
    const row = s as unknown as Record<string, unknown> & {
      stores?: { name: string } | { name: string }[] | null
      attendance_records?: unknown[] | unknown | null
    }
    const st = Array.isArray(row.stores) ? row.stores[0] : row.stores
    const att = Array.isArray(row.attendance_records) ? row.attendance_records.length > 0 : !!row.attendance_records
    const workDate = row.work_date as string
    return {
      id: row.id as string,
      store_id: row.store_id as string,
      store_name: st?.name ?? null,
      work_date: workDate,
      start_time: String(row.start_time).slice(0, 5),
      end_time: String(row.end_time).slice(0, 5),
      is_on_leave: !!row.is_on_leave,
      has_attendance: att,
      can_convert: !att && !row.is_on_leave && workDate >= today,
    }
  })
}

export async function buildOffboardingPreview(
  admin: SupabaseClient,
  emp: TerminationTarget,
  lastDay: string,
  today = turkeyToday()
): Promise<OffboardingPreview> {
  const [shifts, leaveRes, approvedRes, tcRes, swapRes, balance] = await Promise.all([
    loadFutureShifts(admin, emp.id, lastDay, today),
    admin.from('leave_requests').select('id').eq('employee_id', emp.id).eq('status', 'pending'),
    admin.from('leave_requests').select('id').eq('employee_id', emp.id).eq('status', 'approved').gt('start_date', lastDay),
    admin.from('manual_time_correction_requests').select('id').eq('employee_id', emp.id).eq('status', 'pending'),
    admin.from('shift_swap_requests').select('id')
      .eq('status', 'pending').or(`requester_id.eq.${emp.id},target_id.eq.${emp.id}`),
    computeTerminationLeaveBalance(admin, emp, lastDay),
  ])
  for (const r of [leaveRes, approvedRes, tcRes, swapRes]) if (r.error) throw r.error
  const conflict = shifts.filter((s) => s.has_attendance).map((s) => s.work_date).sort()[0] ?? null
  return {
    last_day: lastDay,
    deactivates_now: lastDay < today,
    future_shifts: shifts,
    attendance_conflict_date: conflict,
    pending_leave: leaveRes.data?.length ?? 0,
    future_approved_leave: approvedRes.data?.length ?? 0,
    pending_time_corrections: tcRes.data?.length ?? 0,
    pending_swaps: swapRes.data?.length ?? 0,
    leave_balance: {
      known: balance.known,
      entitlement_days: balance.entitlementDays,
      used_days: balance.usedDays,
      remaining_days: balance.known ? Math.max(0, balance.remainingDays) : 0,
      scope: LEAVE_BALANCE_SCOPE,
      note: LEAVE_BALANCE_NOTE,
    },
  }
}

export interface CancelledSwap {
  id: string
  requester_id: string
  target_id: string | null
  requester_shift_date: string | null
  target_shift_date: string | null
}

export interface OffboardingResult {
  shifts_deleted: number
  shifts_converted: number
  leave_cancelled: number
  time_corrections_cancelled: number
  swaps_cancelled: number
  /** Denetim kaydı için: iptal edilen takasların ayrıntısı (vardiya silinince satırlar CASCADE ile gider) */
  swaps: CancelledSwap[]
  leave_balance: number | null
  deactivated_now: boolean
  prev_active: boolean
}

/**
 * Ayrılışı uygular. Çağıran yetki / mağaza / hiyerarşi kontrollerini yapmış olmalıdır.
 * Yazmalar apply_employee_offboarding RPC'sinde tek transaction'dır; RPC hata verirse
 * (OffboardingError dışında) hata olduğu gibi fırlatılır ve veritabanında hiçbir şey değişmemiştir.
 */
export async function applyOffboarding(
  admin: SupabaseClient,
  params: {
    emp: TerminationTarget
    actorId: string
    lastDay: string
    reason: string
    note: string | null
    convertToOpenShifts: boolean
    today?: string
  }
): Promise<OffboardingResult> {
  const { emp, actorId, lastDay, reason, note, convertToOpenShifts } = params
  const today = params.today ?? turkeyToday()

  // Kaydı olan vardiyayı silmeden önce reddet (RPC de aynı korumayı yapar)
  const shifts = await loadFutureShifts(admin, emp.id, lastDay, today)
  const conflict = shifts.filter((s) => s.has_attendance).map((s) => s.work_date).sort()[0]
  if (conflict) throw new OffboardingError('HAS_ATTENDANCE', attendanceConflictMessage(conflict))

  const balance = await computeTerminationLeaveBalance(admin, emp, lastDay)
  const leaveBalance = balance.known ? Math.max(0, balance.remainingDays) : null

  const { data, error } = await admin.rpc('apply_employee_offboarding', {
    p_employee_id: emp.id,
    p_actor_id: actorId,
    p_last_day: lastDay,
    p_reason: reason,
    p_note: note,
    p_leave_balance: leaveBalance,
    p_convert: convertToOpenShifts,
    p_cancel_note: `${emp.full_name} işten ayrıldığı için otomatik iptal edildi.`,
  })
  if (error) {
    const msg = error.message ?? ''
    const att = /HAS_ATTENDANCE:(\d{4}-\d{2}-\d{2})/.exec(msg)
    if (att) throw new OffboardingError('HAS_ATTENDANCE', attendanceConflictMessage(att[1]))
    if (msg.includes('ALREADY_TERMINATED')) throw new OffboardingError('ALREADY_TERMINATED', 'Bu çalışanın işten çıkışı zaten kayıtlı.')
    if (msg.includes('NOT_FOUND')) throw new OffboardingError('NOT_FOUND', 'Çalışan bulunamadı.')
    throw error
  }

  const r = (data ?? {}) as Record<string, unknown>
  const swaps = (Array.isArray(r.swaps) ? r.swaps : []) as CancelledSwap[]

  // Başarıdan sonra: karşı tarafa bildirim. related_id verilmez (takas satırı vardiya silinince gider);
  // bildirim /my-schedule sayfasına bağlanır (bkz. notificationLinks).
  const notices = swaps.flatMap((s) => {
    const other = s.requester_id === emp.id ? s.target_id : s.requester_id
    return other && other !== emp.id
      ? [{
          employee_id: other,
          type: 'shift_swap_rejected' as const,
          title: 'Takas talebi iptal edildi',
          message: `${emp.full_name} işten ayrıldığı için vardiya takas talebi iptal edildi.`,
          related_id: null,
        }]
      : []
  })
  await createNotifications(admin, notices).catch((e) => console.error('[offboarding] swap notify:', e))

  return {
    shifts_deleted: Number(r.shifts_deleted ?? 0),
    shifts_converted: Number(r.shifts_converted ?? 0),
    leave_cancelled: Number(r.leave_cancelled ?? 0),
    time_corrections_cancelled: Number(r.time_corrections_cancelled ?? 0),
    swaps_cancelled: swaps.length,
    swaps,
    leave_balance: leaveBalance,
    deactivated_now: r.deactivated_now === true,
    prev_active: r.prev_active !== false,
  }
}

/**
 * Ayrılışı geri alır (yalnızca Admin çağırır): alanları temizler. `active` yalnızca ayrılış öncesi
 * değeri neyse ona döner (termination_prev_active; kayıt yoksa true — ayrılış yalnızca aktif çalışana
 * başlatılabilir). Böylece ayrılıştan bağımsız pasifleştirilmiş biri yanlışlıkla aktifleşmez.
 */
export async function undoOffboarding(admin: SupabaseClient, employeeId: string): Promise<boolean> {
  const { data: cur, error: curErr } = await admin
    .from('employees')
    .select('termination_prev_active, active, termination_date')
    .eq('id', employeeId)
    .not('termination_date', 'is', null)
    .maybeSingle()
  if (curErr) throw curErr
  if (!cur) return false
  const row = cur as { termination_prev_active: boolean | null; active: boolean; termination_date: string }
  // Ayrılış henüz yürürlüğe girmediği halde pasif ise pasifliğin nedeni ayrılış değildir (elle pasifleştirilmiş): pasif kalır
  const manuallyInactive = !row.active && row.termination_date >= turkeyToday()
  const restoreActive = manuallyInactive ? false : (row.termination_prev_active ?? true)
  const { data, error } = await admin
    .from('employees')
    .update({
      active: restoreActive,
      termination_date: null,
      termination_reason: null,
      termination_note: null,
      terminated_by: null,
      terminated_at: null,
      termination_leave_balance: null,
      termination_prev_active: null,
    })
    .eq('id', employeeId)
    .not('termination_date', 'is', null)
    .select('id')
    .maybeSingle()
  if (error) throw error
  return !!data
}
