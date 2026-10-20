/**
 * timeCorrectionService — Manuel mesai düzeltme uygulama mantığı (server).
 *
 * Hem çalışan talebi onayında (review/route.ts) hem yönetici doğrudan
 * girişinde (time-correction/route.ts POST direct) kullanılır.
 *
 * Davranış:
 *   1. Vardiya (plan) KORUNUR. O gün plan varsa düzeltme en çok örtüşen vardiyanın
 *      devam kaydına yazılır; plan yoksa (planlanmamış çalışma) düzeltme saatleriyle
 *      bir vardiya oluşturulur. Böylece planlanan ↔ fiili karşılaştırması bozulmaz.
 *   2. Devam kaydı: giriş/çıkış düzeltilmiş saatlere ayarlanır, çıkış girişten
 *      küçükse ertesi gün sayılır (gece vardiyası). Mola elle girilmez: kayda mola
 *      yazılmaz, düşülecek mola süre hesabında otomatik bulunur (bkz. attendanceDurations).
 *   3. Çalışma süresi ihlalleri checkCorrectionViolations ile önceden hesaplanır;
 *      route'lar yöneticinin açık onayı olmadan ihlalli düzeltmeyi uygulamaz.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { grossMins } from '@/lib/laborLaw'
import { deductedBreakMinutes } from '@/lib/attendanceDurations'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { validateShiftAssignment, type WorkingTimeViolation } from '@/lib/workingTimeService'
import { getWeekDays } from '@/lib/scheduleUtils'
import { addDaysToDateString } from '@/lib/dateUtils'
import type { EmploymentType } from '@/types/employee'

export interface ApplyParams {
  admin: SupabaseClient
  employeeId: string
  date: string         // 'YYYY-MM-DD'
  startTime: string    // 'HH:MM'
  endTime: string      // 'HH:MM' (startTime'dan küçükse ertesi gün)
}

export interface ApplyResult {
  attendanceRecordId: string
  shiftAssignmentId: string
  createdShift: boolean
  /** Otomatik düşülen mola (dk) — denetim kaydı için */
  breakMinutes: number
}

/**
 * HH:MM + YYYY-MM-DD (Europe/Istanbul duvar saati) → ISO timestamp.
 * Türkiye 2016'dan beri sabit UTC+3; QR kayıtlarıyla tutarlı olması için offset açıkça eklenir.
 */
export function toTurkeyISO(date: string, time: string): string {
  return new Date(`${date}T${time.slice(0, 5)}:00.000+03:00`).toISOString()
}

/** Düzeltme saatlerinin giriş/çıkış ISO'ları (gece yarısını geçen düzeltme desteklenir) */
export function correctionTimestamps(date: string, startTime: string, endTime: string) {
  const overnight = endTime.slice(0, 5) <= startTime.slice(0, 5)
  return {
    clockIn: toTurkeyISO(date, startTime),
    clockOut: toTurkeyISO(overnight ? addDaysToDateString(date, 1) : date, endTime),
  }
}

function toMins(t: string) {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

function overlapMins(aS: string, aE: string, bS: string, bE: string): number {
  const s1 = toMins(aS), s2 = toMins(bS)
  const e1 = s1 + grossMins(aS, aE), e2 = s2 + grossMins(bS, bE)
  return Math.max(0, Math.min(e1, e2) - Math.max(s1, s2))
}

interface ShiftRow { id: string; work_date: string; start_time: string; end_time: string }

/** O günün vardiyalarından düzeltmeyle en çok örtüşeni (yoksa ilkini) seçer */
function pickShift(shifts: ShiftRow[], startTime: string, endTime: string): ShiftRow | null {
  if (shifts.length === 0) return null
  return [...shifts].sort(
    (a, b) =>
      overlapMins(b.start_time, b.end_time, startTime, endTime) -
        overlapMins(a.start_time, a.end_time, startTime, endTime) ||
      a.start_time.localeCompare(b.start_time)
  )[0]
}

/**
 * Düzeltmenin çalışma süresi kurallarına etkisi (uygulamadan önce).
 * O haftanın ve komşu günlerin diğer vardiyaları + düzeltilmiş saatler kontrol edilir.
 */
export async function checkCorrectionViolations(
  params: ApplyParams
): Promise<{ errors: WorkingTimeViolation[]; warnings: WorkingTimeViolation[] }> {
  const { admin, employeeId, date, startTime, endTime } = params
  const weekDays = getWeekDays(new Date(`${date}T12:00:00`))
  const weekStart = weekDays[0]
  const weekEnd = weekDays[6]

  const [{ data: shifts, error }, { data: emp }] = await Promise.all([
    admin
      .from('shift_assignments')
      .select('id, work_date, start_time, end_time')
      .eq('employee_id', employeeId)
      .gte('work_date', addDaysToDateString(weekStart, -1))
      .lte('work_date', addDaysToDateString(weekEnd, 1)),
    admin.from('employees').select('employment_type').eq('id', employeeId).maybeSingle(),
  ])
  if (error) throw error

  const all = (shifts ?? []) as ShiftRow[]
  const target = pickShift(all.filter((s) => s.work_date === date), startTime, endTime)

  const result = validateShiftAssignment({
    newDate: date,
    newStart: startTime,
    newEnd: endTime,
    existingShifts: all,
    excludeId: target?.id,
    weekStart,
    weekEnd,
    config: getWorkingTimeConfig(),
    employment_type: ((emp?.employment_type ?? 'full_time') as EmploymentType),
  })
  return { errors: result.errors, warnings: result.warnings }
}

/**
 * Düzeltmeyi uygular. DB hatasında fırlatır (çağıran route isteği geri alır).
 */
export async function applyTimeCorrection(params: ApplyParams): Promise<ApplyResult> {
  const { admin, employeeId, date, startTime, endTime } = params
  const start = startTime.slice(0, 5)
  const end = endTime.slice(0, 5)

  // ── 1. Vardiya (plan) — korunur; yoksa oluşturulur ─────────
  const { data: dayShifts, error: shErr } = await admin
    .from('shift_assignments')
    .select('id, work_date, start_time, end_time')
    .eq('employee_id', employeeId)
    .eq('work_date', date)
  if (shErr) throw shErr

  let shift = pickShift((dayShifts ?? []) as ShiftRow[], start, end)
  let createdShift = false
  if (!shift) {
    const { data: created, error: insErr } = await admin
      .from('shift_assignments')
      .insert({
        employee_id: employeeId,
        shift_template_id: null,
        work_date: date,
        start_time: start,
        end_time: end,
        is_on_leave: false,
      })
      .select('id, work_date, start_time, end_time')
      .single()
    if (insErr) throw insErr
    shift = created as ShiftRow
    createdShift = true
  }

  // ── 2. Devam kaydı ──────────────────────────────────────────
  const { clockIn, clockOut } = correctionTimestamps(date, start, end)
  const fields = {
    clock_in_at: clockIn,
    clock_out_at: clockOut,
    break_start_at: null,
    break_end_at: null,
    completed_break_minutes: 0,
    status: 'clocked_out',
    verification_method: 'manual_correction',
  }

  const { data: existing, error: exErr } = await admin
    .from('attendance_records')
    .select('id')
    .eq('shift_assignment_id', shift.id)
    .maybeSingle()
  if (exErr) throw exErr

  let recordId: string
  if (existing) {
    const { error: upErr } = await admin.from('attendance_records').update(fields).eq('id', existing.id)
    if (upErr) throw upErr
    recordId = existing.id as string
  } else {
    const { data: rec, error: recErr } = await admin
      .from('attendance_records')
      .insert({ employee_id: employeeId, shift_assignment_id: shift.id, ...fields })
      .select('id')
      .single()
    if (recErr) throw recErr
    recordId = rec.id as string
  }

  const breakMinutes = deductedBreakMinutes(fields, shift)
  return { attendanceRecordId: recordId, shiftAssignmentId: shift.id, createdShift, breakMinutes }
}
