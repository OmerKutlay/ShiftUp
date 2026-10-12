/**
 * laborLaw — 4857 sayılı İş Kanunu'ndan türetilen saf kurallar.
 *
 * Tüm süreler dakika cinsindendir. Mağaza politikaları (ör. uzun vardiyalarda
 * daha uzun mola) yasal asgarinin ÜSTÜNDE olabilir; bu modül yasal tabanı verir.
 *
 *   Md. 41  — Fazla çalışma: haftalık 45 saati aşan süre, saat ücreti %50 zamlı; yıllık en fazla 270 saat.
 *   Md. 46  — Hafta tatili: 7 günlük zaman dilimi içinde kesintisiz en az 24 saat dinlenme.
 *   Md. 53  — Yıllık ücretli izin: 1–5 yıl 14 gün, 5–15 yıl 20 gün, 15+ yıl 26 gün;
 *             18 yaş ve altı / 50 yaş ve üstü en az 20 gün.
 *   Md. 63  — Günlük çalışma süresi 11 saati aşamaz.
 *   Md. 68  — Ara dinlenme: ≤4s → 15 dk, 4–7,5s → 30 dk, >7,5s → 1 saat.
 *   Md. 69  — Gece (20:00–06:00) çalışması 7,5 saati aşamaz.
 */

export const MAX_DAILY_WORK_MINS = 11 * 60
export const MAX_WEEKLY_WORK_MINS = 45 * 60
export const MAX_NIGHT_WORK_MINS = 7.5 * 60
export const ANNUAL_OVERTIME_CAP_HOURS = 270
export const OVERTIME_MULTIPLIER = 1.5
export const NIGHT_START_MINS = 20 * 60
export const NIGHT_END_MINS = 6 * 60
export const WEEKLY_REST_MIN_HOURS = 24

function toMins(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

/** Brüt vardiya süresi (gece yarısını geçenler dahil) */
export function grossMins(startTime: string, endTime: string): number {
  const s = toMins(startTime)
  let e = toMins(endTime)
  if (e <= s) e += 24 * 60
  return e - s
}

/** Md. 68 — brüt çalışma süresine göre yasal asgari ara dinlenme */
export function statutoryMinBreakMins(gross: number): number {
  if (gross <= 0) return 0
  if (gross <= 4 * 60) return 15
  if (gross <= 7.5 * 60) return 30
  return 60
}

/**
 * Vardiyanın gece dilimine (20:00–06:00) düşen dakikaları.
 * Gece yarısını geçen vardiyalar ve iki ayrı gece dilimine taşan vardiyalar desteklenir.
 */
export function nightMinutes(startTime: string, endTime: string): number {
  const s = toMins(startTime)
  const e = s + grossMins(startTime, endTime)
  // Gece pencereleri: [-4h, 06:00], [20:00, 30:00], [44:00, 54:00] (önceki/aynı/sonraki gün)
  const windows: Array<[number, number]> = [
    [NIGHT_START_MINS - 24 * 60, NIGHT_END_MINS],
    [NIGHT_START_MINS, NIGHT_END_MINS + 24 * 60],
    [NIGHT_START_MINS + 24 * 60, NIGHT_END_MINS + 48 * 60],
  ]
  return windows.reduce((sum, [ws, we]) => sum + Math.max(0, Math.min(e, we) - Math.max(s, ws)), 0)
}

/**
 * Md. 69 — gece çalışması ihlali var mı?
 * Mola çalışma süresinden sayılmaz; molanın gece diliminde kullanıldığı varsayılır.
 *   - Gece dilimindeki çalışma (gece dakikası − mola) 7,5 saati aşamaz.
 *   - Çalışmanın yarısından fazlası gecedeyse vardiya "gece vardiyası"dır ve
 *     toplam net çalışma 7,5 saati aşamaz.
 */
export function nightWorkViolation(startTime: string, endTime: string, netMins: number): boolean {
  const night = nightMinutes(startTime, endTime)
  const gross = grossMins(startTime, endTime)
  const breakMins = Math.max(0, gross - netMins)
  const nightWork = Math.max(0, night - breakMins)
  if (nightWork > MAX_NIGHT_WORK_MINS) return true
  return night * 2 > gross && netMins > MAX_NIGHT_WORK_MINS
}

/**
 * 18 yaşından küçük işçiler (İş K. Md. 73; Çocuk ve Genç İşçilerin Çalıştırılma Usul ve
 * Esasları Hk. Yönetmelik): gece (20:00–06:00) çalıştırılamaz, günde en fazla 8 saat çalışır.
 * İhlal mesajlarını döner (boş dizi = uygun).
 */
export const MINOR_MAX_DAILY_MINS = 8 * 60

export function minorWorkViolations(age: number | null, startTime: string, endTime: string, netMins: number): string[] {
  if (age === null || age >= 18) return []
  const out: string[] = []
  if (nightMinutes(startTime, endTime) > 0) out.push('18 yaşından küçük çalışan gece (20:00–06:00) çalıştırılamaz.')
  if (netMins > MINOR_MAX_DAILY_MINS) out.push('18 yaşından küçük çalışan günde en fazla 8 saat çalışabilir.')
  return out
}

/** Md. 41 — haftalık net çalışma dakikasından fazla çalışma dakikası */
export function weeklyOvertimeMins(weeklyNetMins: number): number {
  return Math.max(0, weeklyNetMins - MAX_WEEKLY_WORK_MINS)
}

/**
 * Md. 53 — yıllık ücretli izin hakkı (gün).
 * @param seniorityYears tamamlanmış hizmet yılı (deneme süresi dahil)
 * @param age yaş (opsiyonel) — 18 ve altı / 50 ve üstü için en az 20 gün
 */
export function annualLeaveEntitlementDays(seniorityYears: number, age?: number | null): number {
  if (seniorityYears < 1) return 0
  let days = seniorityYears >= 15 ? 26 : seniorityYears > 5 ? 20 : 14
  if (age != null && (age <= 18 || age >= 50)) days = Math.max(days, 20)
  return days
}

/** İki tarih arasında tamamlanmış yıl sayısı (YYYY-MM-DD) */
export function completedYears(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split('-').map(Number)
  const [ty, tm, td] = toDate.split('-').map(Number)
  let years = ty - fy
  if (tm < fm || (tm === fm && td < fd)) years--
  return Math.max(0, years)
}
