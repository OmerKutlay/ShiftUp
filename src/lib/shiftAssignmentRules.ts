/**
 * shiftAssignmentRules — bir çalışana bir vardiya verilmeden önce sunucu tarafı kontrol.
 *
 * Takas onayı, açık vardiya alma ve plan aktarımı aynı kuralları kullanır:
 *   - Pasif çalışan / onaylı izin günü
 *   - Komşu günlerle saat çakışması (gece vardiyaları dahil)
 *   - Çalışma süresi kuralları (dinlenme, günlük/haftalık net, gece, part-time)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { validateShiftAssignment, netWorkMins, type WorkingTimeViolation } from '@/lib/workingTimeService'
import { completedYears, minorWorkViolations } from '@/lib/laborLaw'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { getWeekDays } from '@/lib/scheduleUtils'
import { addDaysToDateString } from '@/lib/dateUtils'
import { shiftAbsoluteRange } from '@/lib/scheduleUtils'
import type { EmploymentType } from '@/types/employee'

export interface CandidateShift {
  work_date: string
  start_time: string
  end_time: string
}

export interface RuleCheckResult {
  /** İşlemi kesin engelleyen durumlar (pasif, izin, çakışma) — onayla aşılamaz */
  blockers: string[]
  /** Çalışma süresi ihlalleri — yöneticinin açık onayıyla aşılabilir */
  violations: WorkingTimeViolation[]
  warnings: WorkingTimeViolation[]
}

/**
 * employeeId'ye `shift` verilirse kurallar ihlal ediliyor mu?
 * @param ignoreShiftIds bu vardiyalar hesaba katılmaz (ör. takasta el değiştirecek vardiya)
 */
export async function checkAssignmentRules(
  admin: SupabaseClient,
  employeeId: string,
  shift: CandidateShift,
  ignoreShiftIds: string[] = []
): Promise<RuleCheckResult> {
  const blockers: string[] = []
  const weekDays = getWeekDays(new Date(`${shift.work_date}T12:00:00`))
  const from = addDaysToDateString(weekDays[0], -1)
  const to = addDaysToDateString(weekDays[6], 1)

  const [empRes, shiftsRes, leaveRes] = await Promise.all([
    admin.from('employees').select('id, full_name, active, employment_type, birth_date').eq('id', employeeId).maybeSingle(),
    admin
      .from('shift_assignments')
      .select('id, work_date, start_time, end_time')
      .eq('employee_id', employeeId)
      .gte('work_date', from)
      .lte('work_date', to),
    admin
      .from('leave_requests')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .lte('start_date', shift.work_date)
      .gte('end_date', shift.work_date)
      .limit(1),
  ])
  if (empRes.error) throw empRes.error
  if (shiftsRes.error) throw shiftsRes.error
  if (leaveRes.error) throw leaveRes.error

  const emp = empRes.data
  const name = emp?.full_name ?? 'Çalışan'
  if (!emp) return { blockers: ['Çalışan bulunamadı.'], violations: [], warnings: [] }
  if (!emp.active) blockers.push(`${name} aktif değil.`)
  if (leaveRes.data && leaveRes.data.length > 0) blockers.push(`${name}, ${shift.work_date} tarihinde onaylı izinde.`)

  const existing = ((shiftsRes.data ?? []) as Array<{ id: string; work_date: string; start_time: string; end_time: string }>)
    .filter((s) => !ignoreShiftIds.includes(s.id))

  const [aS, aE] = shiftAbsoluteRange(shift.work_date, shift.start_time, shift.end_time)
  const clash = existing.find((s) => {
    const [bS, bE] = shiftAbsoluteRange(s.work_date, s.start_time, s.end_time)
    return aS < bE && bS < aE
  })
  // 18 yaş altı korumaları (gece yasağı, günlük 8 saat) — yasal yasak, onayla aşılamaz
  const age = emp.birth_date ? completedYears(emp.birth_date as string, shift.work_date) : null
  for (const msg of minorWorkViolations(age, shift.start_time, shift.end_time, netWorkMins(shift.start_time, shift.end_time))) {
    blockers.push(`${name}: ${msg}`)
  }

  if (clash) {
    blockers.push(`${name}: ${clash.work_date} ${clash.start_time.slice(0, 5)}–${clash.end_time.slice(0, 5)} vardiyasıyla çakışıyor.`)
  }

  const result = validateShiftAssignment({
    newDate: shift.work_date,
    newStart: shift.start_time,
    newEnd: shift.end_time,
    existingShifts: existing,
    weekStart: weekDays[0],
    weekEnd: weekDays[6],
    config: getWorkingTimeConfig(),
    employment_type: (emp.employment_type ?? 'full_time') as EmploymentType,
  })

  return {
    blockers,
    // Çakışma zaten blocker olarak raporlandı; tekrarlama
    violations: result.errors
      .filter((v) => v.type !== 'overlap')
      .map((v) => ({ ...v, message: `${name}: ${v.message}` })),
    warnings: result.warnings.map((v) => ({ ...v, message: `${name}: ${v.message}` })),
  }
}

/** Bu vardiyalardan herhangi birinde devam kaydı (giriş yapılmış) var mı? */
export async function shiftsHaveAttendance(admin: SupabaseClient, shiftIds: string[]): Promise<boolean> {
  if (shiftIds.length === 0) return false
  const { data, error } = await admin
    .from('attendance_records')
    .select('id')
    .in('shift_assignment_id', shiftIds)
    .limit(1)
  if (error) throw error
  return (data ?? []).length > 0
}
