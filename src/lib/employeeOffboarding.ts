/**
 * employeeOffboarding — işten ayrılış önizlemesi ve uygulaması (yalnızca server).
 *
 * Önizleme (preview) hiçbir şey değiştirmez; uygulama (apply) aynı hesapları kullanır:
 *   - son çalışma gününden SONRAKİ vardiyalar (tüm mağazalarda) silinir ya da açık vardiyaya çevrilir
 *   - bekleyen izin / mesai düzeltme / takas talepleri iptal edilir (karşı taraf bildirilir)
 *   - son çalışma gününden sonra başlayan onaylı izinler iptal edilir
 *   - çıkış tarihindeki kullanılmamış yıllık izin (İş K. Md. 59) hesaplanıp kaydedilir
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

export interface OffboardingShift {
  id: string
  store_id: string
  store_name: string | null
  work_date: string
  start_time: string
  end_time: string
  is_on_leave: boolean
}

export interface OffboardingPreview {
  last_day: string
  /** Son gün bugünden önceyse hesap hemen pasifleşir */
  deactivates_now: boolean
  future_shifts: OffboardingShift[]
  pending_leave: number
  future_approved_leave: number
  pending_time_corrections: number
  pending_swaps: number
  leave_balance: {
    known: boolean
    entitlement_days: number
    used_days: number
    remaining_days: number
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

async function loadFutureShifts(admin: SupabaseClient, employeeId: string, lastDay: string): Promise<OffboardingShift[]> {
  const { data, error } = await admin
    .from('shift_assignments')
    .select('id, store_id, work_date, start_time, end_time, is_on_leave, stores ( name )')
    .eq('employee_id', employeeId)
    .gt('work_date', lastDay)
    .order('work_date')
    .order('start_time')
  if (error) throw error
  return (data ?? []).map((s) => {
    const row = s as unknown as Record<string, unknown> & { stores?: { name: string } | { name: string }[] | null }
    const st = Array.isArray(row.stores) ? row.stores[0] : row.stores
    return {
      id: row.id as string,
      store_id: row.store_id as string,
      store_name: st?.name ?? null,
      work_date: row.work_date as string,
      start_time: String(row.start_time).slice(0, 5),
      end_time: String(row.end_time).slice(0, 5),
      is_on_leave: !!row.is_on_leave,
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
    loadFutureShifts(admin, emp.id, lastDay),
    admin.from('leave_requests').select('id').eq('employee_id', emp.id).eq('status', 'pending'),
    admin.from('leave_requests').select('id').eq('employee_id', emp.id).eq('status', 'approved').gt('start_date', lastDay),
    admin.from('manual_time_correction_requests').select('id').eq('employee_id', emp.id).eq('status', 'pending'),
    admin.from('shift_swap_requests').select('id')
      .eq('status', 'pending').or(`requester_id.eq.${emp.id},target_id.eq.${emp.id}`),
    computeTerminationLeaveBalance(admin, emp, lastDay),
  ])
  for (const r of [leaveRes, approvedRes, tcRes, swapRes]) if (r.error) throw r.error
  return {
    last_day: lastDay,
    deactivates_now: lastDay < today,
    future_shifts: shifts,
    pending_leave: leaveRes.data?.length ?? 0,
    future_approved_leave: approvedRes.data?.length ?? 0,
    pending_time_corrections: tcRes.data?.length ?? 0,
    pending_swaps: swapRes.data?.length ?? 0,
    leave_balance: {
      known: balance.known,
      entitlement_days: balance.entitlementDays,
      used_days: balance.usedDays,
      remaining_days: balance.known ? Math.max(0, balance.remainingDays) : 0,
    },
  }
}

export interface OffboardingResult {
  shifts_deleted: number
  shifts_converted: number
  leave_cancelled: number
  time_corrections_cancelled: number
  swaps_cancelled: number
  leave_balance: number | null
  deactivated_now: boolean
}

/**
 * Ayrılışı uygular. Çağıran yetki / mağaza / hiyerarşi kontrollerini yapmış olmalıdır.
 * `employees` satırı koşullu güncellenir (termination_date hâlâ boşsa): eşzamanlı çift çıkış engellenir.
 * Satır güncellenemezse (zaten ayrılmış) null döner.
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
): Promise<OffboardingResult | null> {
  const { emp, actorId, lastDay, reason, note, convertToOpenShifts } = params
  const today = params.today ?? turkeyToday()
  const nowIso = new Date().toISOString()
  const deactivateNow = lastDay < today

  const balance = await computeTerminationLeaveBalance(admin, emp, lastDay)
  const leaveBalance = balance.known ? Math.max(0, balance.remainingDays) : null

  const { data: updated, error: updErr } = await admin
    .from('employees')
    .update({
      termination_date: lastDay,
      termination_reason: reason,
      termination_note: note,
      terminated_by: actorId,
      terminated_at: nowIso,
      termination_leave_balance: leaveBalance,
      ...(deactivateNow ? { active: false } : {}),
    })
    .eq('id', emp.id)
    .is('termination_date', null)
    .select('id')
    .maybeSingle()
  if (updErr) throw updErr
  if (!updated) return null

  const cancelNote = `${emp.full_name} işten ayrıldığı için otomatik iptal edildi.`
  const review = { reviewer_note: cancelNote, reviewed_by: actorId, reviewed_at: nowIso }

  // Talepler
  const { data: l1, error: e1 } = await admin
    .from('leave_requests').update({ status: 'rejected', ...review })
    .eq('employee_id', emp.id).eq('status', 'pending').select('id')
  if (e1) throw e1
  const { data: l2, error: e2 } = await admin
    .from('leave_requests').update({ status: 'rejected', ...review })
    .eq('employee_id', emp.id).eq('status', 'approved').gt('start_date', lastDay).select('id')
  if (e2) throw e2
  const { data: tc, error: e3 } = await admin
    .from('manual_time_correction_requests').update({ status: 'rejected', ...review })
    .eq('employee_id', emp.id).eq('status', 'pending').select('id')
  if (e3) throw e3

  const { data: swaps, error: swapErr } = await admin
    .from('shift_swap_requests')
    .select('id, requester_id, target_id')
    .eq('status', 'pending')
    .or(`requester_id.eq.${emp.id},target_id.eq.${emp.id}`)
  if (swapErr) throw swapErr
  const swapRows = (swaps ?? []) as Array<{ id: string; requester_id: string; target_id: string | null }>
  if (swapRows.length > 0) {
    const { error } = await admin
      .from('shift_swap_requests')
      .update({ status: 'cancelled', ...review })
      .in('id', swapRows.map((s) => s.id))
    if (error) throw error
    // Karşı taraf bilgilendirilir
    const notices = swapRows.flatMap((s) => {
      const other = s.requester_id === emp.id ? s.target_id : s.requester_id
      return other && other !== emp.id
        ? [{
            employee_id: other,
            type: 'shift_swap_rejected' as const,
            title: 'Takas talebi iptal edildi',
            message: `${emp.full_name} işten ayrıldığı için vardiya takas talebi iptal edildi.`,
            related_id: s.id,
          }]
        : []
    })
    await createNotifications(admin, notices).catch((e) => console.error('[offboarding] swap notify:', e))
  }

  // Gelecek vardiyalar (tüm mağazalar)
  const shifts = await loadFutureShifts(admin, emp.id, lastDay)
  let converted = 0
  if (shifts.length > 0) {
    if (convertToOpenShifts) {
      const rows = shifts.filter((s) => !s.is_on_leave).map((s) => ({
        store_id: s.store_id,
        work_date: s.work_date,
        start_time: s.start_time,
        end_time: s.end_time,
        description: `${emp.full_name} işten ayrıldı`,
        status: 'open',
      }))
      if (rows.length > 0) {
        const { error } = await admin.from('open_shifts').insert(rows)
        if (error) throw error
        converted = rows.length
      }
    }
    const { error } = await admin.from('shift_assignments').delete().in('id', shifts.map((s) => s.id))
    if (error) throw error
  }

  if (deactivateNow) await revokeAccess(admin, emp.id)

  return {
    shifts_deleted: shifts.length,
    shifts_converted: converted,
    leave_cancelled: (l1?.length ?? 0) + (l2?.length ?? 0),
    time_corrections_cancelled: tc?.length ?? 0,
    swaps_cancelled: swapRows.length,
    leave_balance: leaveBalance,
    deactivated_now: deactivateNow,
  }
}

/** Push aboneliklerini siler ve (varsa) Auth oturumlarını kapatır */
export async function revokeAccess(admin: SupabaseClient, employeeId: string): Promise<void> {
  await admin.from('push_subscriptions').delete().eq('employee_id', employeeId)
  const { data } = await admin.from('employees').select('auth_user_id').eq('id', employeeId).maybeSingle()
  const authUserId = (data as { auth_user_id?: string | null } | null)?.auth_user_id
  if (authUserId) await admin.auth.admin.signOut(authUserId).catch(() => undefined)
}

/** Ayrılışı geri alır (yalnızca Admin çağırır): aktifliği geri verir, alanları temizler */
export async function undoOffboarding(admin: SupabaseClient, employeeId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('employees')
    .update({
      active: true,
      termination_date: null,
      termination_reason: null,
      termination_note: null,
      terminated_by: null,
      terminated_at: null,
      termination_leave_balance: null,
    })
    .eq('id', employeeId)
    .not('termination_date', 'is', null)
    .select('id')
    .maybeSingle()
  if (error) throw error
  return !!data
}
