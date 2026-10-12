/**
 * annualLeave — yıllık ücretli izin hakkı ve bakiyesi (İş K. Md. 53, 56) — saf fonksiyonlar.
 *
 * - Hak, her hizmet yılı dolduğunda doğar: 1–5 yıl 14, 5–15 yıl 20, 15+ yıl 26 iş günü;
 *   18 yaş ve altı / 50 yaş ve üstü için en az 20 gün.
 * - İzin dönemi: son işe giriş yıl dönümünden bir sonrakine kadar.
 * - Md. 56: izne rastlayan hafta tatili ve resmi tatil günleri izinden sayılmaz.
 *   Hafta tatili olarak Pazar varsayılır (mağazada farklı gün kullanılıyorsa yönetici
 *   bakiyeyi düzeltme izniyle dengeleyebilir).
 */
import { annualLeaveEntitlementDays, completedYears } from '@/lib/laborLaw'
import { addDaysToDateString, dayOfWeekFromDateString } from '@/lib/dateUtils'

export interface AnnualLeaveRequestLike {
  start_date: string
  end_date: string
  status: 'pending' | 'approved' | 'rejected'
}

export interface AnnualLeaveBalance {
  /** İşe giriş tarihi girilmemişse hesap yapılamaz */
  known: boolean
  seniorityYears: number
  entitlementDays: number
  periodStart: string | null
  periodEnd: string | null
  usedDays: number
  pendingDays: number
  remainingDays: number
}

/** Aralıktaki izinden sayılan gün sayısı (Pazar ve tam gün resmi tatiller hariç) */
export function countLeaveDays(start: string, end: string, fullDayHolidays: Set<string>): number {
  let n = 0
  for (let d = start; d <= end; d = addDaysToDateString(d, 1)) {
    if (dayOfWeekFromDateString(d) === 0) continue
    if (fullDayHolidays.has(d)) continue
    n++
  }
  return n
}

/** Son yıl dönümü (bugün dahil) — hire 2020-03-15, today 2026-10-12 → 2026-03-15 */
function lastAnniversary(hireDate: string, today: string): string {
  const years = completedYears(hireDate, today)
  const [y, m, d] = hireDate.split('-').map(Number)
  const year = y + years
  // 29 Şubat → artık olmayan yılda 28 Şubat
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, daysInMonth)).padStart(2, '0')}`
}

export function computeAnnualLeaveBalance(params: {
  hireDate: string | null
  birthDate: string | null
  today: string
  requests: AnnualLeaveRequestLike[]   // yalnızca annual tipindeki talepler
  fullDayHolidays: Set<string>
}): AnnualLeaveBalance {
  const { hireDate, birthDate, today, requests, fullDayHolidays } = params
  if (!hireDate || hireDate > today) {
    return { known: false, seniorityYears: 0, entitlementDays: 0, periodStart: null, periodEnd: null, usedDays: 0, pendingDays: 0, remainingDays: 0 }
  }

  const seniority = completedYears(hireDate, today)
  const age = birthDate ? completedYears(birthDate, today) : null
  const entitlement = annualLeaveEntitlementDays(seniority, age)

  const periodStart = lastAnniversary(hireDate, today)
  const nextYear = `${Number(periodStart.slice(0, 4)) + 1}${periodStart.slice(4)}`
  const periodEnd = addDaysToDateString(nextYear, -1)

  let used = 0
  let pending = 0
  for (const r of requests) {
    if (r.status === 'rejected') continue
    const s = r.start_date > periodStart ? r.start_date : periodStart
    const e = r.end_date < periodEnd ? r.end_date : periodEnd
    if (s > e) continue
    const days = countLeaveDays(s, e, fullDayHolidays)
    if (r.status === 'approved') used += days
    else pending += days
  }

  return {
    known: true,
    seniorityYears: seniority,
    entitlementDays: entitlement,
    periodStart,
    periodEnd,
    usedDays: used,
    pendingDays: pending,
    remainingDays: entitlement - used - pending,
  }
}
