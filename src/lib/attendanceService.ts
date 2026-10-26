/**
 * attendanceService — giriş / mola / çıkış işlemlerinin tek, ortak uygulaması.
 *
 * Giriş / mola / çıkış yalnızca QR okutma (/api/qr/process) ile işlenir.
 * Kurallar:
 *   - "Bugün" Türkiye saatine göre hesaplanır (sunucu UTC olsa bile).
 *   - Gece yarısını geçen vardiyada çıkış/mola ertesi gün de yapılabilir
 *     (dünün açık kaydı veya penceresi devam eden vardiyası bulunur).
 *   - Bir vardiya için tek devam kaydı vardır; çıkıştan sonra tekrar giriş yapılamaz.
 *   - Güncelleme okunan duruma koşulludur (optimistic lock) — çift /
 *     eşzamanlı okutma ikinci kez uygulanmaz.
 *   - İzinli (is_on_leave) vardiyalarda işlem yapılamaz.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyAction, AttendanceRuleError, buildFieldPatch } from '@/lib/attendanceStateMachine'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'
import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'
import { getShiftWindow, notifyIfLateAttendance } from '@/lib/attendanceAlerts'
import { resolveRecordedTime } from '@/lib/attendanceRounding'
import { turkeyDateString, addDaysToDateString } from '@/lib/dateUtils'

export interface ShiftRow {
  id: string
  employee_id: string
  /** Vardiyanın mağazası — geç okutma bildirimi o mağazanın yöneticilerine gider */
  store_id: string
  work_date: string
  start_time: string
  end_time: string
  is_on_leave?: boolean | null
}

export class NoShiftError extends Error {
  constructor(message = 'Bugün için vardiya bulunamadı.') {
    super(message)
    this.name = 'NoShiftError'
  }
}

/** Erken giriş penceresi: vardiya başlangıcından en fazla bu kadar önce giriş yapılabilir */
const EARLY_CLOCK_IN_MINS = 120

/**
 * Çalışanın şu an işlem yapacağı vardiyayı ve (varsa) devam kaydını bulur.
 *
 * Öncelik:
 *   1. Açık (çıkış yapılmamış) kaydı olan vardiya — dün başlamış gece vardiyası dahil
 *   2. Kaydı olmayan, penceresi uygun vardiya (bugün; ya da hâlâ süren dünkü gece vardiyası)
 *   3. Bugünün çıkışı yapılmış vardiyası (state machine anlamlı hata versin diye)
 */
export async function findCurrentShift(
  admin: SupabaseClient,
  employeeId: string,
  now: Date = new Date()
): Promise<{ shift: ShiftRow; record: AttendanceRecord | null }> {
  const today = turkeyDateString(now)
  const yesterday = addDaysToDateString(today, -1)

  const { data: shifts, error: shiftError } = await admin
    .from('shift_assignments')
    .select('id, employee_id, store_id, work_date, start_time, end_time, is_on_leave')
    .eq('employee_id', employeeId)
    .gte('work_date', yesterday)
    .lte('work_date', today)

  if (shiftError) throw shiftError
  const candidates = ((shifts ?? []) as ShiftRow[]).filter((s) => !s.is_on_leave)
  if (candidates.length === 0) throw new NoShiftError()

  const { data: records, error: recError } = await admin
    .from('attendance_records')
    .select('*')
    .in('shift_assignment_id', candidates.map((s) => s.id))

  if (recError) throw recError
  const recordByShift = new Map(
    ((records ?? []) as AttendanceRecord[]).map((r) => [r.shift_assignment_id, r])
  )

  // 1. Açık kayıt
  const open = candidates.find((s) => {
    const r = recordByShift.get(s.id)
    return r && r.status !== 'clocked_out'
  })
  if (open) return { shift: open, record: recordByShift.get(open.id) ?? null }

  // 2. Kaydı olmayan, zaman penceresi uygun vardiya
  const nowMs = now.getTime()
  const fresh = candidates
    .filter((s) => !recordByShift.has(s.id))
    .filter((s) => {
      const { start, end } = getShiftWindow(s)
      if (s.work_date === today) return nowMs < end.getTime() + 6 * 3600_000 // bugünün vardiyası: geç girişe izin ver
      return nowMs >= start.getTime() - EARLY_CLOCK_IN_MINS * 60_000 && nowMs < end.getTime()
    })
    .sort((a, b) => {
      const da = Math.abs(getShiftWindow(a).start.getTime() - nowMs)
      const dbb = Math.abs(getShiftWindow(b).start.getTime() - nowMs)
      return da - dbb
    })
  if (fresh.length > 0) return { shift: fresh[0], record: null }

  // 3. Bugünün tamamlanmış vardiyası
  const done = candidates.find((s) => s.work_date === today && recordByShift.has(s.id))
  if (done) return { shift: done, record: recordByShift.get(done.id) ?? null }

  throw new NoShiftError()
}

export interface PerformActionInput {
  admin: SupabaseClient
  shift: ShiftRow
  record: AttendanceRecord | null
  employeeId: string
  employeeName: string
  action: AttendanceAction
  verificationMethod: string
  now?: Date
  /** Giriş/çıkış tolerans yuvarlaması uygulansın mı (QR: evet, yönetici manuel: hayır) */
  applyRounding?: boolean
  /** Geç giriş/çıkış bildirimi gönderilsin mi */
  notifyLate?: boolean
  /** Kayda yazılacak ek alanlar (ör. konum doğrulama mesafesi/doğruluğu) */
  extraFields?: Record<string, unknown>
}

export interface PerformActionResult {
  record: AttendanceRecord
  recordedAt: string
  scannedAt: string
  adjusted: boolean
}

export async function performAttendanceAction(input: PerformActionInput): Promise<PerformActionResult> {
  const {
    admin, shift, record, employeeId, employeeName, action, verificationMethod,
    applyRounding = true, notifyLate = true, extraFields = {},
  } = input
  const now = input.now ?? new Date()
  const currentStatus: AttendanceStatus = (record?.status ?? 'shift_waiting') as AttendanceStatus

  if (shift.is_on_leave) {
    throw new AttendanceRuleError('Bu vardiya izinli olarak işaretli; devam işlemi yapılamaz.')
  }

  // State machine geçişini doğrula (geçersizse AttendanceRuleError)
  const nextStatus = applyAction(currentStatus, action)

  const recorded = applyRounding
    ? resolveRecordedTime(shift, action, now, record)
    : { recordedAt: now.toISOString() as string, exceptionNote: undefined as string | undefined }

  // Geç girişte işlenen saat ileri yuvarlanır; mola bu saatten önce başlatılamaz
  if ((action === 'start_break' || action === 'end_break') && record?.clock_in_at) {
    if (new Date(recorded.recordedAt).getTime() < new Date(record.clock_in_at).getTime()) {
      const t = new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(record.clock_in_at))
      throw new AttendanceRuleError(`Mola, işlenen giriş saatinden (${t}) önce başlatılamaz.`)
    }
  }

  let updated: AttendanceRecord

  if (action === 'clock_in' && !record) {
    const { data, error } = await admin
      .from('attendance_records')
      .insert({
        employee_id: employeeId,
        shift_assignment_id: shift.id,
        status: nextStatus,
        clock_in_at: recorded.recordedAt,
        verification_method: verificationMethod,
        ...extraFields,
        ...(recorded.exceptionNote ? { exception_note: recorded.exceptionNote } : {}),
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        throw new AttendanceRuleError('Bu vardiya için zaten bir devam kaydı var.')
      }
      throw error
    }
    updated = data as AttendanceRecord
  } else if (record) {
    const patch = buildFieldPatch(currentStatus, action, recorded.recordedAt, record)
    const { data, error } = await admin
      .from('attendance_records')
      .update({
        ...patch,
        verification_method: verificationMethod,
        ...extraFields,
        ...(recorded.exceptionNote ? { exception_note: recorded.exceptionNote } : {}),
      })
      .eq('id', record.id)
      .eq('status', currentStatus)
      .select()
      .maybeSingle()

    if (error) throw error
    if (!data) {
      throw new AttendanceRuleError('Bu işlem az önce başka bir istekle uygulandı. Lütfen durumu yenileyin.')
    }
    updated = data as AttendanceRecord
  } else {
    throw new AttendanceRuleError('Önce giriş yapmalısın.')
  }

  if (notifyLate && (action === 'clock_in' || action === 'clock_out')) {
    await notifyIfLateAttendance(admin, {
      storeId: shift.store_id,
      employeeId,
      employeeName,
      shift,
      action,
      at: now,
      recordedAt: new Date(recorded.recordedAt),
    })
  }

  return {
    record: updated,
    recordedAt: recorded.recordedAt,
    scannedAt: now.toISOString(),
    adjusted: !!recorded.exceptionNote,
  }
}

/** Kiosk QR'da aksiyon seçilmediyse duruma göre mantıklı sonraki aksiyon */
export function suggestNextAction(status: AttendanceStatus): AttendanceAction {
  switch (status) {
    case 'shift_waiting': return 'clock_in'
    case 'working': return 'start_break'
    case 'on_break': return 'end_break'
    case 'working_after_break': return 'clock_out'
    default: return 'clock_in'
  }
}

export function toTurkeyTime(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(isoString))
  } catch {
    return '--:--'
  }
}
