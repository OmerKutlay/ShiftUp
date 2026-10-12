/**
 * workingTimeConfig — Çalışma süresi kural konfigürasyonu
 *
 * Tek kaynak: tüm validasyon kuralları buradan okunur.
 * İleride DB/settings tablosuna bağlanabilir.
 *
 * Mevcut değerler AB Çalışma Süresi Direktifi (2003/88/EC) esas alınmıştır:
 *   - Ardışık vardiyalar arası min. 11 saat dinlenme
 *   - Günlük maks. 13 saat çalışma (standart 8h + tolerans)
 *   - Haftalık maks. 45 saat çalışma
 */
export interface WorkingTimeConfig {
  /** Ardışık iki vardiya arasındaki minimum dinlenme süresi (saat) */
  minRestHours: number
  /** Bir çalışanın aynı takvim gününde çalışabileceği maksimum toplam saat */
  maxDailyWorkHours: number
  /** Bir çalışanın bir haftada (Pzt–Paz) çalışabileceği maksimum toplam saat */
  maxWeeklyWorkHours: number
  /**
   * Vardiya başına düşülecek mola süresi (dakika).
   * Net çalışma süresi = brüt vardiya süresi − breakMins.
   * Çakışma/dinlenme kontrolleri brüt süreyi kullanmaya devam eder;
   * sadece haftalık/günlük çalışma saati raporları net süreyi kullanır.
   */
  breakMins: number
}

export const DEFAULT_WORKING_TIME_CONFIG: WorkingTimeConfig = {
  minRestHours: 11,
  maxDailyWorkHours: 13,
  maxWeeklyWorkHours: 45,
  breakMins: 60,  // 1 saat mola her vardiyada
}

/**
 * Runtime konfigürasyon — ileride env veya DB'den yüklenebilir.
 * Şimdilik default değerleri döner.
 */
export function getWorkingTimeConfig(): WorkingTimeConfig {
  return {
    minRestHours:     Number(process.env.WT_MIN_REST_HOURS    ?? DEFAULT_WORKING_TIME_CONFIG.minRestHours),
    maxDailyWorkHours: Number(process.env.WT_MAX_DAILY_HOURS  ?? DEFAULT_WORKING_TIME_CONFIG.maxDailyWorkHours),
    maxWeeklyWorkHours: Number(process.env.WT_MAX_WEEKLY_HOURS ?? DEFAULT_WORKING_TIME_CONFIG.maxWeeklyWorkHours),
    breakMins:        Number(process.env.WT_BREAK_MINS        ?? DEFAULT_WORKING_TIME_CONFIG.breakMins),
  }
}
