/**
 * timesheet — aylık puantaj hesabı (saf fonksiyonlar, DB'siz).
 *
 * Gün kodları (bordro uygulamalarıyla uyumlu kısaltmalar):
 *   Ç   çalıştı            RTÇ resmi tatilde çalıştı (Md. 47 — ek günlük ücret)
 *   HT  hafta tatili       RT  resmi tatil (çalışmadı)
 *   Yİ  yıllık izin        Rİ  raporlu (hastalık)
 *   Üİ  ücretsiz izin      Mİ  mazeret / diğer izin
 *   D   devamsız (planlı vardiyaya gelmedi)
 *   P   planlı (henüz gerçekleşmedi)
 *
 * Fazla çalışma (Md. 41): Pazartesi–Pazar haftasında 45 saati aşan NET fiili çalışma.
 * Hafta, Pazar günü hangi aydaysa o ayın puantajına yazılır.
 * SGK prim günü: ay 30 gün kabul edilir; ücretsiz izin ve devamsız günler düşülür.
 */
import { workedMinutes, type AttendanceTimes } from '@/lib/attendanceDurations'
import { MAX_WEEKLY_WORK_MINS, NIGHT_END_MINS, NIGHT_START_MINS } from '@/lib/laborLaw'
import { plannedBreakMins } from '@/lib/workingTimeService'
import { addDaysToDateString, dayOfWeekFromDateString } from '@/lib/dateUtils'
import type { PublicHoliday } from '@/types/holiday'

export type TimesheetCode = 'Ç' | 'RTÇ' | 'HT' | 'RT' | 'Yİ' | 'Rİ' | 'Üİ' | 'Mİ' | 'D' | 'P' | ''

export const TIMESHEET_CODE_LABELS: Record<Exclude<TimesheetCode, ''>, string> = {
  'Ç': 'Çalıştı',
  'RTÇ': 'Resmi tatilde çalıştı',
  'HT': 'Hafta tatili',
  'RT': 'Resmi tatil',
  'Yİ': 'Yıllık izin',
  'Rİ': 'Raporlu',
  'Üİ': 'Ücretsiz izin',
  'Mİ': 'Mazeret / diğer izin',
  'D': 'Devamsız',
  'P': 'Planlı',
}

export interface TimesheetEmployee {
  id: string
  full_name: string
  /** Sistem rolü adı (gösterim) */
  role_name: string
  employment_type: 'full_time' | 'part_time'
  overtime_consent_at?: string | null
}

export interface TimesheetShift {
  id: string
  employee_id: string
  work_date: string
  start_time: string
  end_time: string
  is_on_leave?: boolean | null
  attendance: (AttendanceTimes & { status?: string }) | null
}

/** Vardiyanın net fiili çalışması: planlanan mola ile fiili moladan büyüğü düşülür */
function shiftWorkedMins(s: TimesheetShift): number {
  return s.attendance ? workedMinutes(s.attendance, plannedBreakMins(s.start_time, s.end_time)) ?? 0 : 0
}

export interface TimesheetLeave {
  employee_id: string
  leave_type: string
  start_date: string
  end_date: string
}

export interface TimesheetRow {
  employee: TimesheetEmployee
  days: Record<string, TimesheetCode>
  /** Çalışılan günlerin net dakikası (yalnızca Ç / RTÇ günleri) */
  dayMins: Record<string, number>
  /** Planlı / devamsız günlerin ilk vardiya saati (HH:MM) */
  dayPlan: Record<string, { start: string; end: string }>
  workedMins: number
  nightMins: number
  overtimeMins: number
  holidayWorkedDays: number
  workedDays: number
  absentDays: number
  leaveDays: Record<'Yİ' | 'Rİ' | 'Üİ' | 'Mİ' | 'HT', number>
  sgkDays: number
  /** Fazla çalışma var ama çalışanın yazılı onayı kayıtlı değil */
  overtimeWithoutConsent: boolean
}

const LEAVE_CODE: Record<string, TimesheetCode> = {
  weekly_rest: 'HT',
  annual: 'Yİ',
  sick: 'Rİ',
  unpaid: 'Üİ',
  personal: 'Mİ',
  other: 'Mİ',
}

/** Ayın günleri (YYYY-MM-DD) */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** Ayın puantajı için gereken veri aralığı: ilk haftanın Pazartesi'sinden son haftanın Pazar'ına */
export function timesheetDataRange(month: string): { from: string; to: string } {
  const days = monthDays(month)
  const first = days[0]
  const last = days[days.length - 1]
  const back = (dayOfWeekFromDateString(first) + 6) % 7          // Pazartesi'ye kadar geri
  const fwd = (7 - dayOfWeekFromDateString(last)) % 7            // Pazar'a kadar ileri
  return { from: addDaysToDateString(first, -back), to: addDaysToDateString(last, fwd) }
}

/** Mutlak zaman aralığının Türkiye saatine göre gece dilimine (20:00–06:00) düşen dakikaları */
export function nightMinutesBetween(fromIso: string, toIso: string): number {
  const start = new Date(fromIso).getTime()
  const end = new Date(toIso).getTime()
  if (!(end > start)) return 0
  const TR_OFFSET = 3 * 60 * 60_000
  // Türkiye takvim günü başlangıcı (UTC ms) — gece pencereleri bu günlere göre kurulur
  const dayMs = 86_400_000
  let total = 0
  for (let d = Math.floor((start + TR_OFFSET) / dayMs) - 1; d * dayMs - TR_OFFSET <= end; d++) {
    const dayStart = d * dayMs - TR_OFFSET
    const ws = dayStart + NIGHT_START_MINS * 60_000
    const we = dayStart + dayMs + NIGHT_END_MINS * 60_000
    total += Math.max(0, Math.min(end, we) - Math.max(start, ws))
  }
  return Math.round(total / 60_000)
}

export function buildTimesheet(params: {
  month: string
  employees: TimesheetEmployee[]
  shifts: TimesheetShift[]          // timesheetDataRange aralığındaki vardiyalar
  leaves: TimesheetLeave[]          // onaylı izinler (aralıkla kesişen)
  holidays: PublicHoliday[]
  today: string                     // Türkiye tarihi — gelecekteki vardiyalar devamsız sayılmaz
}): TimesheetRow[] {
  const { month, employees, shifts, leaves, holidays, today } = params
  const days = monthDays(month)
  const daySet = new Set(days)
  const holidayByDate = new Map(holidays.map((h) => [h.date, h]))

  return employees.map((emp) => {
    const empShifts = shifts.filter((s) => s.employee_id === emp.id && !s.is_on_leave)
    const empLeaves = leaves.filter((l) => l.employee_id === emp.id)
    const leaveCodeOn = (date: string): TimesheetCode | null => {
      const l = empLeaves.find((x) => x.start_date <= date && x.end_date >= date)
      return l ? LEAVE_CODE[l.leave_type] ?? 'Mİ' : null
    }

    const row: TimesheetRow = {
      employee: emp,
      days: {},
      dayMins: {},
      dayPlan: {},
      workedMins: 0,
      nightMins: 0,
      overtimeMins: 0,
      holidayWorkedDays: 0,
      workedDays: 0,
      absentDays: 0,
      leaveDays: { 'Yİ': 0, 'Rİ': 0, 'Üİ': 0, 'Mİ': 0, 'HT': 0 },
      sgkDays: 0,
      overtimeWithoutConsent: false,
    }

    // ── Gün kodları ve ay içi toplamlar ──
    for (const date of days) {
      const dayShifts = empShifts.filter((s) => s.work_date === date)
      const worked = dayShifts.filter((s) => s.attendance?.clock_in_at)
      const holiday = holidayByDate.get(date)
      const leaveCode = leaveCodeOn(date)

      let code: TimesheetCode = ''
      if (worked.length > 0) {
        code = holiday ? 'RTÇ' : 'Ç'
        row.workedDays++
        if (holiday && !holiday.half_day) row.holidayWorkedDays++
        let dayTotal = 0
        for (const s of worked) {
          dayTotal += shiftWorkedMins(s)
          if (s.attendance!.clock_in_at && s.attendance!.clock_out_at) {
            row.nightMins += nightMinutesBetween(s.attendance!.clock_in_at, s.attendance!.clock_out_at)
          }
        }
        row.workedMins += dayTotal
        row.dayMins[date] = dayTotal
      } else if (leaveCode) {
        code = leaveCode
        if (leaveCode in row.leaveDays) row.leaveDays[leaveCode as keyof TimesheetRow['leaveDays']]++
      } else if (holiday && !holiday.half_day) {
        code = 'RT'
      } else if (dayShifts.length > 0) {
        const first = [...dayShifts].sort((a, b) => a.start_time.localeCompare(b.start_time))[0]
        row.dayPlan[date] = { start: first.start_time.slice(0, 5), end: first.end_time.slice(0, 5) }
        if (date < today) {
          code = 'D'
          row.absentDays++
        } else {
          code = 'P'
        }
      }
      row.days[date] = code
    }

    // ── Haftalık fazla çalışma (Pazar'ı bu ayda olan haftalar) ──
    const sundays = days.filter((d) => dayOfWeekFromDateString(d) === 0)
    for (const sunday of sundays) {
      const monday = addDaysToDateString(sunday, -6)
      const weekMins = empShifts
        .filter((s) => s.work_date >= monday && s.work_date <= sunday && s.attendance?.clock_in_at)
        .reduce((sum, s) => sum + shiftWorkedMins(s), 0)
      row.overtimeMins += Math.max(0, weekMins - MAX_WEEKLY_WORK_MINS)
    }
    row.overtimeWithoutConsent = row.overtimeMins > 0 && !emp.overtime_consent_at

    // ── SGK prim günü (ay 30 gün kabul) ──
    const base = Math.min(30, days.length)
    row.sgkDays = Math.max(0, base - row.leaveDays['Üİ'] - row.absentDays)

    // Ay dışı günler kodlanmaz
    for (const k of Object.keys(row.days)) if (!daySet.has(k)) delete row.days[k]
    return row
  })
}
