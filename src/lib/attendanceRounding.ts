/**
 * attendanceRounding — Giriş/çıkış okutma saatinin sisteme işlenecek saate yuvarlanması
 *
 * Giriş (vardiya başlangıcı S'ye göre gecikme):
 *   - 15 dk'dan az gecikme (veya erken giriş) → okutulan saat aynen işlenir   (10:00 vardiya, 10:13 → 10:13)
 *   - 15–30 dk  → S+30                                                         (10:15–10:30 → 10:30)
 *   - 31–45 dk  → S+45                                                         (10:31–10:45 → 10:45)
 *   - 46–60 dk  → S+60, sonrası da bir sonraki çeyrek saate yukarı yuvarlanır  (10:46–11:00 → 11:00)
 *
 * Çıkış (vardiya bitişi E'ye göre erken çıkış) — girişin aynası:
 *   - 15 dk'dan az erken (veya geç çıkış) → okutulan saat aynen işlenir   (18:00 vardiya, 17:47 → 17:47)
 *   - 15–30 dk erken → E-30                                               (17:30–17:45 → 17:30)
 *   - 31–45 dk erken → E-45                                               (17:15–17:29 → 17:15)
 *   - sonrası bir önceki çeyrek saate aşağı yuvarlanır                    (17:00–17:14 → 17:00)
 *
 * Hesaplama dakika hassasiyetindedir (saniyeler göz ardı edilir).
 */
import { getShiftWindow, type ShiftLike } from '@/lib/attendanceAlerts'

const MINUTE_MS = 60 * 1000
const STEP_MINS = 15

export interface AttendanceRoundingConfig {
  /** Bu dakikanın altındaki sapmalar yuvarlanmaz */
  toleranceMins: number
}

export const DEFAULT_ATTENDANCE_ROUNDING_CONFIG: AttendanceRoundingConfig = {
  toleranceMins: 15,
}

export interface RoundedAttendanceTime {
  /** Sisteme işlenecek saat */
  recordedAt: Date
  /** Okutmanın gerçekleştiği saat (dakikaya indirgenmiş) */
  scannedAt: Date
  /** Yuvarlama uygulandı mı */
  adjusted: boolean
}

export function roundAttendanceTime(
  shift: ShiftLike,
  action: 'clock_in' | 'clock_out',
  at: Date,
  config: AttendanceRoundingConfig = DEFAULT_ATTENDANCE_ROUNDING_CONFIG,
): RoundedAttendanceTime {
  const scannedAt = new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS)
  const { start, end } = getShiftWindow(shift)
  const tolerance = config.toleranceMins
  const minRounded = tolerance + STEP_MINS // ilk yuvarlama basamağı (15 tolerans → 30)

  if (action === 'clock_in') {
    const lateMins = (scannedAt.getTime() - start.getTime()) / MINUTE_MS
    if (lateMins < tolerance) return { recordedAt: scannedAt, scannedAt, adjusted: false }
    const roundedMins = Math.max(minRounded, Math.ceil(lateMins / STEP_MINS) * STEP_MINS)
    return { recordedAt: new Date(start.getTime() + roundedMins * MINUTE_MS), scannedAt, adjusted: true }
  }

  const earlyMins = (end.getTime() - scannedAt.getTime()) / MINUTE_MS
  if (earlyMins < tolerance) return { recordedAt: scannedAt, scannedAt, adjusted: false }
  const roundedMins = Math.max(minRounded, Math.ceil(earlyMins / STEP_MINS) * STEP_MINS)
  return { recordedAt: new Date(end.getTime() - roundedMins * MINUTE_MS), scannedAt, adjusted: true }
}

/**
 * Attendance route'ları için: aksiyona göre kayda yazılacak saati ve (yuvarlandıysa) açıklamayı döner.
 * Mola aksiyonları yuvarlanmaz. Erken çıkış yuvarlaması giriş/moladan dönüş saatinin gerisine düşmez.
 */
export function resolveRecordedTime(
  shift: ShiftLike,
  action: string,
  now: Date,
  existingRecord?: { clock_in_at?: string | null; break_end_at?: string | null; exception_note?: string | null } | null,
): { recordedAt: string; exceptionNote?: string } {
  if (action !== 'clock_in' && action !== 'clock_out') return { recordedAt: now.toISOString() }

  const rounded = roundAttendanceTime(shift, action, now)
  if (!rounded.adjusted) return { recordedAt: now.toISOString() }

  if (action === 'clock_out') {
    const floor = Math.max(
      existingRecord?.clock_in_at ? new Date(existingRecord.clock_in_at).getTime() : 0,
      existingRecord?.break_end_at ? new Date(existingRecord.break_end_at).getTime() : 0,
    )
    if (rounded.recordedAt.getTime() < floor) rounded.recordedAt = new Date(floor)
  }

  const note = buildRoundingNote(action, rounded)
  const prev = existingRecord?.exception_note?.trim()
  return {
    recordedAt: rounded.recordedAt.toISOString(),
    exceptionNote: prev ? `${prev} | ${note}` : note,
  }
}

/** Kayda düşülecek açıklama: gerçek okutma saati ↔ işlenen saat */
export function buildRoundingNote(
  action: 'clock_in' | 'clock_out',
  rounded: RoundedAttendanceTime,
): string {
  const fmt = (d: Date) => new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d)
  const label = action === 'clock_in' ? 'Giriş' : 'Çıkış'
  return `${label} ${fmt(rounded.scannedAt)}'de okutuldu, ${fmt(rounded.recordedAt)} olarak işlendi.`
}
