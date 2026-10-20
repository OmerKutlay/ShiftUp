/**
 * attendanceDurations — Attendance kayıtlarından süre hesapları (saf fonksiyonlar)
 *
 * break_start_at / break_end_at son molayı tutar; daha önce tamamlanan
 * molaların toplamı completed_break_minutes kolonundadır.
 *
 * Mola kuralı (molalar elle girilmez, otomatik hesaplanır). Çalışan birden çok kez molaya çıkabilir:
 *   - Vardiyayı tamamladı, mola okutmadı      → planlanan mola düşülür (mola yapmış sayılır)
 *   - Vardiyayı tamamladı, mola okuttu        → planlanan mola ile fiili toplam moladan büyüğü düşülür
 *                                               (molasını uzatanın aşan dakikaları da düşer)
 *   - Erken çıktı, mola okutmadı              → mola düşülmez
 *   - Erken çıktı, mola okuttu                → fiili mola düşülür (fiilene göre)
 * Erken çıkış: planlanan bitişten en az EARLY_EXIT_TOLERANCE_MINS dk önce çıkış.
 *
 * Net çalışma tam veya buçuklu saate yuvarlanır (en yakın 30 dk; tam 15 dk aşağı): 7s 46dk → 8s, 7s 45dk → 7s 30dk.
 */
import { plannedBreakMins } from '@/lib/workingTimeService'

export interface AttendanceTimes {
  clock_in_at: string | null
  break_start_at: string | null
  break_end_at: string | null
  clock_out_at: string | null
  completed_break_minutes?: number | null
}

/** Planlı vardiya (Türkiye saati) — planlanan mola ve bitiş saati buradan hesaplanır */
export interface PlannedShift {
  work_date: string   // YYYY-MM-DD
  start_time: string  // HH:MM[:SS]
  end_time: string    // HH:MM[:SS]
}

/** Bu dakikadan az erken çıkış tam vardiya sayılır (çıkış yuvarlama toleransıyla aynı) */
export const EARLY_EXIT_TOLERANCE_MINS = 15
/** Net çalışmanın yuvarlandığı adım (dk) */
export const WORKED_ROUNDING_MINS = 30

const MINUTE_MS = 60_000

/** İki ISO timestamp arasındaki fark (dakika). Biri null ise null. */
export function diffMinutes(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const diff = (new Date(to).getTime() - new Date(from).getTime()) / MINUTE_MS
  return Math.max(0, Math.round(diff))
}

/** Toplam fiili mola süresi: önceki molalar + son (tamamlanmış) mola */
export function totalBreakMinutes(rec: AttendanceTimes): number {
  return (rec.completed_break_minutes ?? 0) + (diffMinutes(rec.break_start_at, rec.break_end_at) ?? 0)
}

/** Mola okutulmuş mu (önceki molalar dahil) */
export function hasScannedBreak(rec: AttendanceTimes): boolean {
  return !!rec.break_start_at || (rec.completed_break_minutes ?? 0) > 0
}

/** Planlanan vardiya bitişi (ms) — gece yarısını geçen vardiya ertesi güne taşınır */
export function plannedShiftEndMs(shift: PlannedShift): number {
  const start = new Date(`${shift.work_date}T${shift.start_time.slice(0, 5)}:00+03:00`).getTime()
  let end = new Date(`${shift.work_date}T${shift.end_time.slice(0, 5)}:00+03:00`).getTime()
  if (end <= start) end += 24 * 60 * MINUTE_MS
  return end
}

/** Planlanan bitişten en az tolerans kadar önce çıkış yapıldı mı */
export function isEarlyExit(rec: AttendanceTimes, shift: PlannedShift): boolean {
  if (!rec.clock_out_at) return false
  const earlyMins = (plannedShiftEndMs(shift) - new Date(rec.clock_out_at).getTime()) / MINUTE_MS
  return earlyMins >= EARLY_EXIT_TOLERANCE_MINS
}

/**
 * Çalışma süresinden düşülen mola (dk) — kural için dosya başına bakın.
 * shift verilmezse yalnızca fiili mola düşülür.
 */
export function deductedBreakMinutes(rec: AttendanceTimes, shift?: PlannedShift | null): number {
  const actual = totalBreakMinutes(rec)
  if (!shift) return actual
  if (isEarlyExit(rec, shift)) return actual
  return Math.max(plannedBreakMins(shift.start_time, shift.end_time), actual)
}

/** Net çalışmayı tam / buçuklu saate yuvarlar (en yakın 30 dk; tam ortası aşağı) */
export function roundWorkedMinutes(mins: number): number {
  return Math.max(0, Math.ceil(mins / WORKED_ROUNDING_MINS - 0.5) * WORKED_ROUNDING_MINS)
}

/**
 * Net çalışma süresi (dk). Giriş veya çıkış yoksa null.
 * shift verilirse mola kuralı uygulanır ve sonuç tam / buçuklu saate yuvarlanır;
 * verilmezse fiili mola düşülmüş ham süre döner.
 */
export function workedMinutes(rec: AttendanceTimes, shift?: PlannedShift | null): number | null {
  if (!rec.clock_in_at || !rec.clock_out_at) return null
  const total = diffMinutes(rec.clock_in_at, rec.clock_out_at) ?? 0
  const net = Math.max(0, total - deductedBreakMinutes(rec, shift))
  return shift ? roundWorkedMinutes(net) : net
}
