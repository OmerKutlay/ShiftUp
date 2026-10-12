/**
 * attendanceDurations — Attendance kayıtlarından süre hesapları (saf fonksiyonlar)
 *
 * break_start_at / break_end_at son molayı tutar; daha önce tamamlanan
 * molaların toplamı completed_break_minutes kolonundadır.
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

/** Toplam mola süresi: önceki molalar + son (tamamlanmış) mola */
export function totalBreakMinutes(rec: AttendanceTimes): number {
  return (rec.completed_break_minutes ?? 0) + (diffMinutes(rec.break_start_at, rec.break_end_at) ?? 0)
}

/** Net çalışma süresi (mola hariç). Giriş veya çıkış yoksa null. */
export function workedMinutes(rec: AttendanceTimes): number | null {
  if (!rec.clock_in_at || !rec.clock_out_at) return null
  const total = diffMinutes(rec.clock_in_at, rec.clock_out_at) ?? 0
  return Math.max(0, total - totalBreakMinutes(rec))
}
