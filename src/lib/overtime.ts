/**
 * overtime — yıllık fazla çalışma takibi (İş K. Md. 41).
 *
 * Haftalık (Pzt–Paz) 45 saati aşan NET fiili çalışma fazla çalışmadır; yıllık toplam
 * 270 saati aşamaz ve işçinin yazılı onayı gerekir. Hafta, Pazar günü hangi yıldaysa
 * o yıla sayılır.
 */
import { workedMinutes, type AttendanceTimes } from '@/lib/attendanceDurations'
import { ANNUAL_OVERTIME_CAP_HOURS, MAX_WEEKLY_WORK_MINS } from '@/lib/laborLaw'
import { plannedBreakMins } from '@/lib/workingTimeService'
import { addDaysToDateString, dayOfWeekFromDateString } from '@/lib/dateUtils'

export interface OvertimeShift {
  employee_id: string
  work_date: string
  /** Planlı vardiya saatleri — planlanan mola bunlardan hesaplanır */
  start_time?: string
  end_time?: string
  attendance: AttendanceTimes | null
}

export interface OvertimeWeek {
  weekStart: string   // Pazartesi
  workedMins: number
  overtimeMins: number
}

export interface OvertimeSummary {
  employee_id: string
  full_name: string
  consent_at: string | null
  weeks: OvertimeWeek[]          // yalnızca fazla çalışma olan haftalar
  totalOvertimeMins: number
  capMins: number
  /** Yıllık sınıra oran (0–1+) */
  capRatio: number
  overCap: boolean
  missingConsent: boolean
}

/** Tarihin ait olduğu haftanın Pazartesi'si */
export function mondayOf(date: string): string {
  return addDaysToDateString(date, -((dayOfWeekFromDateString(date) + 6) % 7))
}

/** Yıl için veri aralığı: yılın ilk Pazar'ını içeren haftanın Pazartesi'sinden son Pazar'a */
export function overtimeYearRange(year: number): { from: string; to: string } {
  const jan1 = `${year}-01-01`
  const firstSunday = addDaysToDateString(jan1, (7 - dayOfWeekFromDateString(jan1)) % 7)
  const dec31 = `${year}-12-31`
  const lastSunday = addDaysToDateString(dec31, -dayOfWeekFromDateString(dec31))
  return { from: addDaysToDateString(firstSunday, -6), to: lastSunday }
}

export function summarizeOvertime(
  year: number,
  employees: Array<{ id: string; full_name: string; overtime_consent_at?: string | null }>,
  shifts: OvertimeShift[]
): OvertimeSummary[] {
  const { from, to } = overtimeYearRange(year)
  const capMins = ANNUAL_OVERTIME_CAP_HOURS * 60

  return employees.map((emp) => {
    const byWeek = new Map<string, number>()
    for (const s of shifts) {
      if (s.employee_id !== emp.id || s.work_date < from || s.work_date > to || !s.attendance?.clock_in_at) continue
      const w = mondayOf(s.work_date)
      const planned = s.start_time && s.end_time ? plannedBreakMins(s.start_time, s.end_time) : 0
      byWeek.set(w, (byWeek.get(w) ?? 0) + (workedMinutes(s.attendance, planned) ?? 0))
    }
    const weeks: OvertimeWeek[] = [...byWeek.entries()]
      .map(([weekStart, workedMins]) => ({ weekStart, workedMins, overtimeMins: Math.max(0, workedMins - MAX_WEEKLY_WORK_MINS) }))
      .filter((w) => w.overtimeMins > 0)
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    const total = weeks.reduce((sum, w) => sum + w.overtimeMins, 0)
    return {
      employee_id: emp.id,
      full_name: emp.full_name,
      consent_at: emp.overtime_consent_at ?? null,
      weeks,
      totalOvertimeMins: total,
      capMins,
      capRatio: total / capMins,
      overCap: total > capMins,
      missingConsent: total > 0 && !emp.overtime_consent_at,
    }
  })
}
