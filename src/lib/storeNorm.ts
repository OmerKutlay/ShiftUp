/**
 * storeNorm — mağaza aylık norm saati (işgücü saat bütçesi); saf hesaplar.
 *
 * Üst yönetim her ay mağaza için bir "norm hakkı" belirler (çalışan değil mağaza bazlı).
 * Admin girmediyse norm KAYDEDİLMEZ, burada hesaplanır:
 *   varsayılan = ayda çalışan olan, kiosk olmayan, aktif çalışan sayısı × 45 sa × (ay günü / 7),
 *   10 saate yukarı yuvarlanır. 45 sa yasal haftalık normal çalışma süresidir (fazla mesaisiz
 *   kapasite) — yani varsayılan mağazayı rahatça karşılar.
 * Norm yol göstericidir; planı engellemez.
 */

export type NormSource = 'set' | 'default'
export type NormLevel = 'ok' | 'warn' | 'over'

/** Yasal haftalık normal çalışma süresi (İş K. Md. 63) */
export const WEEKLY_LEGAL_HOURS = 45
/** Kullanım bu orana ulaşınca uyarı (amber) */
export const NORM_WARN_RATIO = 0.9

export interface NormEmployee {
  active: boolean
  isKiosk: boolean
  /** Admin şirket geneli yöneticidir; mağaza kadrosunda sayılmaz */
  isAdmin: boolean
  /** Rolün planlama görevi var mı (planning_group dolu); boşsa vardiyaya planlanmaz */
  planned: boolean
  /** YYYY-MM-DD; boşsa ay başından beri çalışıyor sayılır */
  hire_date?: string | null
}

/** 'YYYY-MM-DD' veya 'YYYY-MM' → 'YYYY-MM-01' (geçersizse null) */
export function normMonthStart(input: string | null | undefined): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(input ?? '')
  return m ? `${m[1]}-${m[2]}-01` : null
}

export function daysInMonth(monthStart: string): number {
  const y = Number(monthStart.slice(0, 4))
  const m = Number(monthStart.slice(5, 7))
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Ayın son günü (YYYY-MM-DD) */
export function monthEnd(monthStart: string): string {
  return `${monthStart.slice(0, 8)}${String(daysInMonth(monthStart)).padStart(2, '0')}`
}

/**
 * Çalışan o ayda (herhangi bir günde) işte mi? Tek yerde tutulur: ayrılış tarihi
 * (termination_date) eklendiğinde yalnızca burası genişletilir.
 */
export function employedDuringMonth(e: Pick<NormEmployee, 'hire_date'>, monthStart: string): boolean {
  return !e.hire_date || e.hire_date <= monthEnd(monthStart)
}

/** Varsayılan norm kadrosu: aktif, kiosk/Admin değil, planlanan bir role sahip ve ayda çalışan */
export function countsForNorm(e: NormEmployee, monthStart: string): boolean {
  if (!e.active || e.isKiosk || e.isAdmin || !e.planned) return false
  return employedDuringMonth(e, monthStart)
}

/** Varsayılanın nasıl türetildiği: "12 kişi × 45 sa × 30/7" */
export function defaultDerivation(employeeCount: number, monthStart: string): string {
  return `${employeeCount} kişi × ${WEEKLY_LEGAL_HOURS} sa × ${daysInMonth(monthStart)}/7`
}

export interface DefaultNorm {
  normHours: number
  employeeCount: number
}

export function computeDefaultNorm(employees: NormEmployee[], monthStart: string): DefaultNorm {
  const employeeCount = employees.filter((e) => countsForNorm(e, monthStart)).length
  const raw = (employeeCount * WEEKLY_LEGAL_HOURS * daysInMonth(monthStart)) / 7
  // Kayan nokta hatası tam katları bir üst 10'a atmasın
  const normHours = Math.ceil(Math.round(raw * 1e6) / 1e6 / 10) * 10
  return { normHours, employeeCount }
}

export interface ResolvedNorm {
  month: string
  normHours: number
  source: NormSource
  /** Admin'in girdiği değer yokken de hesaplanan tahmin (yönetim paneli için) */
  defaultHours: number
  employeeCount: number
  /** Ayın gün sayısı (varsayılan hesabı gösterimi için) */
  monthDays: number
  note: string | null
}

export function resolveStoreNorm(
  monthStart: string,
  employees: NormEmployee[],
  setRow: { norm_hours: number | string; note?: string | null } | null | undefined,
): ResolvedNorm {
  const def = computeDefaultNorm(employees, monthStart)
  if (setRow) {
    return {
      month: monthStart, normHours: Number(setRow.norm_hours), source: 'set',
      defaultHours: def.normHours, employeeCount: def.employeeCount, monthDays: daysInMonth(monthStart), note: setRow.note ?? null,
    }
  }
  return {
    month: monthStart, normHours: def.normHours, source: 'default',
    defaultHours: def.normHours, employeeCount: def.employeeCount, monthDays: daysInMonth(monthStart), note: null,
  }
}

export interface NormUsage {
  plannedHours: number
  remainingHours: number
  /** Yuvarlanmış yüzde (norm 0 ise 0) */
  percent: number
  level: NormLevel
}

export function normLevel(plannedHours: number, normHours: number): NormLevel {
  if (plannedHours > normHours) return 'over'
  if (normHours > 0 && plannedHours >= normHours * NORM_WARN_RATIO) return 'warn'
  return 'ok'
}

export function computeNormUsage(plannedHours: number, normHours: number): NormUsage {
  return {
    plannedHours,
    remainingHours: Math.round((normHours - plannedHours) * 10) / 10,
    percent: normHours > 0 ? Math.round((plannedHours / normHours) * 100) : 0,
    level: normLevel(plannedHours, normHours),
  }
}

/**
 * Bir atama/değişiklik aylık toplamı uyarı eşiğine taşıyor mu?
 * Saat artmadıysa (silme / kısaltma) uyarı yok; artış sonrası eşik üstündeyse 'warn' / 'over'.
 */
export function normWarningFor(beforeHours: number, afterHours: number, normHours: number): NormLevel | null {
  if (afterHours <= beforeHours) return null
  const after = normLevel(afterHours, normHours)
  return after === 'ok' ? null : after
}

export function formatHours(h: number): string {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(h)
}

const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

export function monthLabelTr(monthStart: string, withYear = true): string {
  const name = TR_MONTHS[Number(monthStart.slice(5, 7)) - 1]
  return withYear ? `${name} ${monthStart.slice(0, 4)}` : name
}

/** Haftanın (pazartesi başlangıçlı) çoğunluğunun düştüğü ay: 4. gün (perşembe) hangi aydaysa o */
export function majorityMonthOfWeek(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 3)
  return `${d.toISOString().slice(0, 7)}-01`
}
