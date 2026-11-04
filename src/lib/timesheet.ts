/**
 * timesheet — aylık puantaj hesabı (saf fonksiyonlar, DB'siz).
 *
 * Gün kodları (bordro uygulamalarıyla uyumlu kısaltmalar):
 *   Ç   çalıştı            RTÇ resmi tatilde çalıştı (Md. 47 — ek günlük ücret)
 *   HTÇ hafta tatilinde çalıştı (haftalık tatil kaydı olan günde giriş yapıldı — ek ücretli)
 *   HT  hafta tatili       RT  resmi tatil (çalışmadı)
 *   Yİ  yıllık izin        Rİ  raporlu (hastalık)
 *   Üİ  ücretsiz izin      Mİ  mazeret / diğer izin
 *   D   devamsız (planlı vardiyaya gelmedi)
 *   P   planlı (henüz gerçekleşmedi)
 *
 * Fazla çalışma (Md. 41): Pazartesi–Pazar haftasında 45 saati aşan NET fiili çalışma.
 * Hafta, Pazar günü hangi aydaysa o ayın puantajına yazılır.
 * Hafta tatilinde çalışma (HTÇ günleri) ayrı tutulur: o günün saatleri 45 saat hesabına girmez, tamamı
 * haftanın "HT" saati olarak yazılır (bordroda %50 zamlı ödenir; ikisi toplanınca çift sayılmaz).
 * SGK prim günü: ay 30 gün kabul edilir; ücretsiz izin, rapor ve devamsız günler düşülür (eksik gün).
 */
import { workedMinutes, type AttendanceTimes } from '@/lib/attendanceDurations'
import { MAX_WEEKLY_WORK_MINS, NIGHT_END_MINS, NIGHT_START_MINS } from '@/lib/laborLaw'
import { addDaysToDateString, dayOfWeekFromDateString } from '@/lib/dateUtils'
import type { PublicHoliday } from '@/types/holiday'

export type TimesheetCode = 'Ç' | 'RTÇ' | 'HTÇ' | 'HT' | 'RT' | 'Yİ' | 'Rİ' | 'Üİ' | 'Mİ' | 'D' | 'P' | ''

export const TIMESHEET_CODE_LABELS: Record<Exclude<TimesheetCode, ''>, string> = {
  'Ç': 'Çalıştı',
  'RTÇ': 'Resmi tatilde çalıştı',
  'HTÇ': 'Hafta tatilinde çalıştı',
  'HT': 'Hafta tatili',
  'RT': 'Resmi tatil',
  'Yİ': 'Yıllık izin',
  'Rİ': 'Raporlu',
  'Üİ': 'Ücretsiz izin',
  'Mİ': 'Mazeret / diğer izin',
  'D': 'Devamsız',
  'P': 'Planlı',
}

/**
 * Çıktılarda (Excel / PDF) gün hücresi renkleri — açık zemin + koyu yazı (yazıcıda da okunur).
 * Tonlar ekrandaki takvimle aynı aileden: çalıştı yeşil, resmi tatilde çalıştı turuncu, izin mavi…
 * Değerler `RRGGBB` onaltılıktır.
 */
export const TIMESHEET_CODE_COLORS: Record<Exclude<TimesheetCode, ''>, { fill: string; text: string }> = {
  'Ç': { fill: 'C6EFCE', text: '006100' },
  'RTÇ': { fill: 'FCD5B4', text: '9C4A00' },
  'HTÇ': { fill: 'B7E1DD', text: '0E5A52' },
  'HT': { fill: 'D9D9D9', text: '404040' },
  'RT': { fill: 'FFEB9C', text: '7F6000' },
  'Yİ': { fill: 'BDD7EE', text: '1F4E79' },
  'Rİ': { fill: 'F8CBDA', text: '8B1A4A' },
  'Üİ': { fill: 'EDEDED', text: '595959' },
  'Mİ': { fill: 'E4DFEC', text: '5B2C83' },
  'D': { fill: 'FFC7CE', text: '9C0006' },
  'P': { fill: 'F2F9F4', text: '5E8C6A' },
}

/**
 * Gün hücresinin çıktı değeri: çalışılan günlerde net saat (bir ondalık, sayı), diğer günlerde kod.
 * Saati hesaplanamayan çalışma günü (ör. çıkış okutulmamış) kodla yazılır.
 */
export function timesheetDayValue(row: TimesheetRow, date: string): number | TimesheetCode {
  const code = row.days[date] ?? ''
  const mins = row.dayMins[date] ?? 0
  if ((code === 'Ç' || code === 'RTÇ' || code === 'HTÇ') && mins > 0) return Math.round((mins / 60) * 10) / 10
  return code
}

export interface TimesheetEmployee {
  id: string
  full_name: string
  /** Sistem rolü adı (gösterim) */
  role_name: string
  employment_type: 'full_time' | 'part_time'
  overtime_consent_at?: string | null
  /** İşe giriş tarihi — işte olunan günler ve SGK günü bundan hesaplanır */
  hire_date?: string | null
  /** Son çalışma günü (dahil) */
  termination_date?: string | null
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

/** Vardiyanın net fiili çalışması — mola kuralı ve yuvarlama: bkz. attendanceDurations */
function shiftWorkedMins(s: TimesheetShift): number {
  return s.attendance ? workedMinutes(s.attendance, s) ?? 0 : 0
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
  /** Çalışılan günlerin net dakikası (yalnızca Ç / RTÇ / HTÇ günleri) */
  dayMins: Record<string, number>
  /** Planlı / devamsız günlerin ilk vardiya saati (HH:MM) */
  dayPlan: Record<string, { start: string; end: string }>
  workedMins: number
  nightMins: number
  overtimeMins: number
  /** Haftalık fazla çalışma dakikası; anahtar haftanın Pazar günü (yalnızca Pazar'ı bu ayda olan haftalar) */
  overtimeByWeek: Record<string, number>
  /** Hafta tatilinde çalışılan net dakika (HTÇ), haftalara göre (Pazar anahtarlı, fazla çalışmayla aynı kural) */
  restWorkByWeek: Record<string, number>
  /** restWorkByWeek toplamı */
  restWorkMins: number
  /** Ay içindeki HTÇ günleri */
  restWorkedDays: number
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
  public_holiday: 'RT',
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

/** İşte olunan aralık: ay içindeki ilk ve son gün (1-tabanlı); işe giriş/çıkış bu aralığı daraltır */
export interface EmploymentWindow {
  /** Ayın kaçıncı günü işe başlandı (1 = ay başından beri) */
  fromDay: number
  /** Ayın kaçıncı günü son çalışma günü (ay sonu = ayın gün sayısı) */
  toDay: number
}

/**
 * Ay içinde işte olunan aralık. endDate = employees.termination_date (son çalışma günü, dahil); SGK 16
 * "Fesih tarihinde çalışmamıştır" için toPayrollRows. null = ayın tamamı.
 * Ay dışında (işe giriş ay sonundan sonra / çıkış ay başından önce) → null.
 */
export function employmentWindow(
  month: string,
  hireDate: string | null | undefined,
  endDate?: string | null
): EmploymentWindow | null {
  const len = monthDays(month).length
  const first = `${month}-01`
  const last = `${month}-${String(len).padStart(2, '0')}`
  if (hireDate && hireDate > last) return null
  if (endDate && endDate < first) return null
  const fromDay = hireDate && hireDate > first ? Number(hireDate.slice(8, 10)) : 1
  const toDay = endDate && endDate < last ? Number(endDate.slice(8, 10)) : len
  return { fromDay, toDay: Math.max(fromDay, toDay) }
}

/**
 * SGK'ya göre işte olunan gün (prim günü tavanı): ay 30 gün kabul edilir.
 *   - tam ay → 30 (Şubat dahil: ay sonuna kadar çalışılan Şubat 30 sayılır)
 *   - aksi halde takvim günü sayısı (toDay − fromDay + 1), en çok 30
 * Pencere yoksa (ay dışı) → 0.
 *
 * İşten çıkış: termination_date son çalışma günüdür (dahil); sonraki günler işte olunan gün sayılmaz, yani
 * prim günü çıkış gününde biter. SGK 16 "Fesih tarihinde çalışmamıştır" yalnızca çıkış gününde hiç çalışma
 * kaydı olmadığında o 1 gün için kullanılır (toPayrollRows). Kaynak (üçüncü taraf, SGK metni değil):
 * https://www.alomaliye.com/2012/04/17/sgk-eksik-gun-nedenleri/ , https://www.kazimceylan.av.tr/md/sgk-eksik-gun-kodlari
 */
export function employedSgkDays(month: string, hireDate: string | null | undefined, endDate?: string | null): number {
  const w = employmentWindow(month, hireDate, endDate)
  if (!w) return 0
  const len = monthDays(month).length
  const to = len < 30 && w.toDay === len ? 30 : w.toDay
  return Math.min(30, to - w.fromDay + 1)
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
    // İşe girişten önceki ve son çalışma gününden sonraki günler kodlanmaz (izin / tatil / devamsızlık yazılmaz)
    const window = employmentWindow(month, emp.hire_date ?? null, emp.termination_date ?? null)
    const employed = (date: string) => !!window && Number(date.slice(8, 10)) >= window.fromDay && Number(date.slice(8, 10)) <= window.toDay
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
      overtimeByWeek: {},
      restWorkByWeek: {},
      restWorkMins: 0,
      restWorkedDays: 0,
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

      // Yarım gün tatil (arife) normal gün sayılır
      const fullHoliday = holiday && !holiday.half_day ? holiday : undefined

      let code: TimesheetCode = ''
      if (worked.length > 0) {
        // Tam gün resmi tatil önceliklidir (Md. 47); haftalık tatil kaydı olan gün hafta tatilinde çalışmadır
        code = fullHoliday ? 'RTÇ' : leaveCode === 'HT' ? 'HTÇ' : 'Ç'
        if (code === 'HTÇ') row.restWorkedDays++
        row.workedDays++
        if (fullHoliday) row.holidayWorkedDays++
        let dayTotal = 0
        for (const s of worked) {
          dayTotal += shiftWorkedMins(s)
          if (s.attendance!.clock_in_at && s.attendance!.clock_out_at) {
            row.nightMins += nightMinutesBetween(s.attendance!.clock_in_at, s.attendance!.clock_out_at)
          }
        }
        row.workedMins += dayTotal
        row.dayMins[date] = dayTotal
      } else if (!employed(date)) {
        code = ''
      } else if (leaveCode) {
        code = leaveCode
        if (leaveCode in row.leaveDays) row.leaveDays[leaveCode as keyof TimesheetRow['leaveDays']]++
      } else if (fullHoliday) {
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

    // ── Haftalık fazla çalışma ve hafta tatilinde çalışma (Pazar'ı bu ayda olan haftalar) ──
    // Hafta tatilinde çalışma: haftalık tatil kaydı olan, resmi tatil olmayan günün çalışması (gün koduyla aynı)
    const isRestWork = (date: string) =>
      !(holidayByDate.get(date) && !holidayByDate.get(date)!.half_day)
      && empLeaves.some((l) => l.leave_type === 'weekly_rest' && l.start_date <= date && l.end_date >= date)
    const sundays = days.filter((d) => dayOfWeekFromDateString(d) === 0)
    for (const sunday of sundays) {
      const monday = addDaysToDateString(sunday, -6)
      let weekMins = 0
      let restMins = 0
      for (const s of empShifts) {
        if (s.work_date < monday || s.work_date > sunday || !s.attendance?.clock_in_at) continue
        if (isRestWork(s.work_date)) restMins += shiftWorkedMins(s)
        else weekMins += shiftWorkedMins(s)
      }
      const weekOvertime = Math.max(0, weekMins - MAX_WEEKLY_WORK_MINS)
      row.overtimeByWeek[sunday] = weekOvertime
      row.overtimeMins += weekOvertime
      row.restWorkByWeek[sunday] = restMins
      row.restWorkMins += restMins
    }
    row.overtimeWithoutConsent = row.overtimeMins > 0 && !emp.overtime_consent_at

    // ── SGK prim günü: işte olunan gün (30 esaslı, giriş/çıkış dahil) − eksik gün (rapor, ücretsiz izin,
    //    devamsızlık, çıkış gününde kayıt yoksa o gün). Bordro puantajıyla aynı kural (payrollTimesheet).
    //    31 günlük ayda 31. gün yalnızca işte olunan gün 30 iken eksik gün sayılmaz.
    const employedDays = employedSgkDays(month, emp.hire_date ?? null, emp.termination_date ?? null)
    const skip31 = days.length === 31 && employedDays === 30
    const end = emp.termination_date ?? null
    let missing = 0
    for (const d of days) {
      if (skip31 && d.endsWith('-31')) continue
      const c = row.days[d]
      if (c === 'Rİ' || c === 'Üİ' || c === 'D') missing++
      else if (end && d === end && c === '') missing++
    }
    row.sgkDays = Math.max(0, employedDays - missing)

    // Ay dışı günler kodlanmaz
    for (const k of Object.keys(row.days)) if (!daySet.has(k)) delete row.days[k]
    return row
  })
}
