/**
 * workingTimeConfig — Çalışma süresi kural konfigürasyonu
 *
 * Tek kaynak: tüm validasyon kuralları buradan okunur.
 * Değerler 4857 sayılı İş Kanunu'na göredir (bkz. laborLaw.ts):
 *   - Ardışık vardiyalar arası min. 11 saat dinlenme (mağaza politikası; AB 2003/88/EC ile uyumlu)
 *   - Günlük maks. 11 saat NET çalışma (Md. 63)
 *   - Haftalık maks. 45 saat NET çalışma (Md. 41/63) — aşan kısım fazla çalışmadır
 *
 * Net süre = brüt vardiya − mola (bkz. workingTimeService.netWorkMins).
 * Çakışma/dinlenme kontrolleri brüt (saat dilimi) aralıkları kullanır.
 */
export interface WorkingTimeConfig {
  /** Ardışık iki vardiya arasındaki minimum dinlenme süresi (saat) */
  minRestHours: number
  /** Bir çalışanın aynı takvim gününde çalışabileceği maksimum NET süre (saat) */
  maxDailyWorkHours: number
  /** Bir çalışanın bir haftada (Pzt–Paz) çalışabileceği maksimum NET süre (saat) */
  maxWeeklyWorkHours: number
}

export const DEFAULT_WORKING_TIME_CONFIG: WorkingTimeConfig = {
  minRestHours: 11,
  maxDailyWorkHours: 11,
  maxWeeklyWorkHours: 45,
}

/**
 * Runtime konfigürasyon — env ile sıkılaştırılabilir; yasal üst sınırların
 * (11s/gün, 45s/hafta) üstüne çıkılamaz.
 */
export function getWorkingTimeConfig(): WorkingTimeConfig {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    minRestHours:       num(process.env.WT_MIN_REST_HOURS, DEFAULT_WORKING_TIME_CONFIG.minRestHours),
    maxDailyWorkHours:  Math.min(11, num(process.env.WT_MAX_DAILY_HOURS, DEFAULT_WORKING_TIME_CONFIG.maxDailyWorkHours)),
    maxWeeklyWorkHours: Math.min(45, num(process.env.WT_MAX_WEEKLY_HOURS, DEFAULT_WORKING_TIME_CONFIG.maxWeeklyWorkHours)),
  }
}
