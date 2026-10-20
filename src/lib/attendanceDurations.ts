/**
 * attendanceDurations — Attendance kayıtlarından süre hesapları (saf fonksiyonlar)
 *
 * break_start_at / break_end_at son molayı tutar; daha önce tamamlanan
 * molaların toplamı completed_break_minutes kolonundadır.
 *
 * Mola kuralı: çalışan birden çok kez molaya çıkabilir. Çalışma süresinden
 * planlanan mola ile fiili toplam moladan BÜYÜĞÜ düşülür:
 *   - Mola okutmayan çalışan planlanan molayı yapmış sayılır.
 *   - Molasını uzatan (veya ikinci kez molaya çıkan) çalışanın aşan dakikaları da düşülür.
 */

export interface AttendanceTimes {
  clock_in_at: string | null
  break_start_at: string | null
  break_end_at: string | null
  clock_out_at: string | null
  completed_break_minutes?: number | null
}

/** İki ISO timestamp arasındaki fark (dakika). Biri null ise null. */
export function diffMinutes(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const diff = (new Date(to).getTime() - new Date(from).getTime()) / 60000
  return Math.max(0, Math.round(diff))
}

/** Toplam fiili mola süresi: önceki molalar + son (tamamlanmış) mola */
export function totalBreakMinutes(rec: AttendanceTimes): number {
  return (rec.completed_break_minutes ?? 0) + (diffMinutes(rec.break_start_at, rec.break_end_at) ?? 0)
}

/** Çalışma süresinden düşülen mola: planlanan mola ile fiili toplam moladan büyüğü */
export function deductedBreakMinutes(rec: AttendanceTimes, plannedBreakMins = 0): number {
  return Math.max(plannedBreakMins, totalBreakMinutes(rec))
}

/**
 * Net çalışma süresi (mola hariç). Giriş veya çıkış yoksa null.
 * plannedBreakMins: vardiyanın planlanan molası (bkz. workingTimeService.plannedBreakMins).
 */
export function workedMinutes(rec: AttendanceTimes, plannedBreakMins = 0): number | null {
  if (!rec.clock_in_at || !rec.clock_out_at) return null
  const total = diffMinutes(rec.clock_in_at, rec.clock_out_at) ?? 0
  return Math.max(0, total - deductedBreakMinutes(rec, plannedBreakMins))
}
