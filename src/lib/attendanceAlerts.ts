/**
 * attendanceAlerts — Geç / eksik giriş-çıkış okutma bildirimleri
 *
 * İki tetikleyici:
 *   1. Anlık: QR / buton ile giriş-çıkış yapıldığında, vardiya saatine göre
 *      tolerans aşıldıysa yöneticilere "geç giriş" / "geç çıkış" bildirimi.
 *   2. Periyodik tarama: vardiya başlamış ama giriş okutulmamış ya da vardiya
 *      bitmiş ama çıkış okutulmamış çalışanlar için yöneticilere bildirim.
 *
 * Tüm bildirimler related_id = shift_assignment_id taşır; aynı vardiya için
 * aynı tipte ikinci bildirim gönderilmez.
 *
 * Vardiya saatleri (TIME) Türkiye yerel saatidir. Türkiye 2016'dan beri sabit
 * UTC+3 olduğundan dönüşüm sabit ofsetle yapılır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getExistingNotificationKeys, notifyManagers } from '@/lib/notificationRepository'
import type { NotificationType } from '@/types/notification'

const TURKEY_UTC_OFFSET = '+03:00'
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * MINUTE_MS

export interface AttendanceAlertConfig {
  /** Giriş/çıkış en az bu kadar dakika gecikirse "geç" sayılır (yuvarlama toleransıyla aynı) */
  lateToleranceMins: number
  /** Vardiya başlangıcından bu kadar dakika sonra giriş yoksa "giriş okutulmadı" */
  missedClockInMins: number
  /** Vardiya bitişinden bu kadar dakika sonra çıkış yoksa "çıkış okutulmadı" */
  missedClockOutMins: number
}

export const DEFAULT_ATTENDANCE_ALERT_CONFIG: AttendanceAlertConfig = {
  lateToleranceMins: 15,
  missedClockInMins: 30,
  missedClockOutMins: 30,
}

export function getAttendanceAlertConfig(): AttendanceAlertConfig {
  return {
    lateToleranceMins:  Number(process.env.ATT_LATE_TOLERANCE_MINS   ?? DEFAULT_ATTENDANCE_ALERT_CONFIG.lateToleranceMins),
    missedClockInMins:  Number(process.env.ATT_MISSED_CLOCK_IN_MINS  ?? DEFAULT_ATTENDANCE_ALERT_CONFIG.missedClockInMins),
    missedClockOutMins: Number(process.env.ATT_MISSED_CLOCK_OUT_MINS ?? DEFAULT_ATTENDANCE_ALERT_CONFIG.missedClockOutMins),
  }
}

export interface ShiftLike {
  id: string
  work_date: string   // YYYY-MM-DD
  start_time: string  // HH:MM[:SS]
  end_time: string    // HH:MM[:SS]
}

/** Vardiyanın başlangıç/bitiş anları (UTC Date). Gece yarısını geçen vardiyada bitiş ertesi gündür. */
export function getShiftWindow(shift: ShiftLike): { start: Date; end: Date } {
  const start = new Date(`${shift.work_date}T${shift.start_time.slice(0, 5)}:00${TURKEY_UTC_OFFSET}`)
  let end = new Date(`${shift.work_date}T${shift.end_time.slice(0, 5)}:00${TURKEY_UTC_OFFSET}`)
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + DAY_MS)
  return { start, end }
}

/** Verilen anın Türkiye saatine göre tarihi (YYYY-MM-DD) */
export function turkeyDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function turkeyTime(date: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function turkeyDateLabel(workDate: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long',
  }).format(new Date(`${workDate}T12:00:00${TURKEY_UTC_OFFSET}`))
}

function shiftLabel(shift: ShiftLike): string {
  return `${turkeyDateLabel(shift.work_date)} ${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)}`
}

function formatDelay(mins: number): string {
  if (mins < 60) return `${mins} dk`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`
}

// ─── Anlık: geç giriş / geç çıkış ───────────────────────────────

/**
 * Giriş veya çıkış okutulduğunda gecikmeyi hesaplar; tolerans aşıldıysa yöneticilere bildirir.
 * Hata fırlatmaz — attendance işlemini asla bozmamalı.
 */
export async function notifyIfLateAttendance(
  admin: SupabaseClient,
  params: {
    employeeId: string
    employeeName: string
    shift: ShiftLike
    action: 'clock_in' | 'clock_out'
    at: Date
    /** Yuvarlama sonrası sisteme işlenen saat (farklıysa mesajda gösterilir) */
    recordedAt?: Date
  },
  config: AttendanceAlertConfig = getAttendanceAlertConfig(),
): Promise<void> {
  try {
    const { employeeId, employeeName, shift, action, at, recordedAt } = params
    const { start, end } = getShiftWindow(shift)
    const reference = action === 'clock_in' ? start : end
    const delayMins = Math.floor((at.getTime() - reference.getTime()) / MINUTE_MS)
    if (delayMins < config.lateToleranceMins) return

    const type: NotificationType =
      action === 'clock_in' ? 'attendance_late_clock_in' : 'attendance_late_clock_out'

    const existing = await getExistingNotificationKeys(admin, [type], [shift.id])
    if (existing.has(`${type}:${shift.id}`)) return

    const isIn = action === 'clock_in'
    const recordedNote =
      recordedAt && turkeyTime(recordedAt) !== turkeyTime(at) ? `, işlenen: ${turkeyTime(recordedAt)}` : ''
    await notifyManagers(
      admin,
      {
        type,
        title: isIn ? 'Geç giriş' : 'Geç çıkış',
        message: isIn
          ? `${employeeName}, ${shiftLabel(shift)} vardiyasına ${formatDelay(delayMins)} geç giriş okuttu (giriş: ${turkeyTime(at)}${recordedNote}).`
          : `${employeeName}, ${shiftLabel(shift)} vardiyasından ${formatDelay(delayMins)} geç çıkış okuttu (çıkış: ${turkeyTime(at)}${recordedNote}).`,
        related_id: shift.id,
      },
      { excludeEmployeeId: employeeId },
    )
  } catch (err) {
    console.error('[attendanceAlerts] geç okutma bildirimi gönderilemedi:', err)
  }
}

// ─── Periyodik: okutulmamış giriş / çıkış ───────────────────────

interface ScanShiftRow extends ShiftLike {
  employee_id: string
  is_on_leave: boolean | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  employees: any
}

interface ScanRecordRow {
  shift_assignment_id: string
  clock_in_at: string | null
  clock_out_at: string | null
}

export interface MissedAttendanceAlert {
  type: 'attendance_missed_clock_in' | 'attendance_missed_clock_out'
  shift: ShiftLike
  employeeId: string
  employeeName: string
}

/**
 * Saf fonksiyon: vardiya + attendance kayıtlarından gönderilmesi gereken uyarıları hesaplar.
 * Yalnızca son 24 saat içinde başlamış vardiyalar değerlendirilir (eski kayıtlar için toplu bildirim olmasın).
 */
export function findMissedAttendance(
  shifts: ScanShiftRow[],
  records: ScanRecordRow[],
  now: Date,
  config: AttendanceAlertConfig,
): MissedAttendanceAlert[] {
  const byShift = new Map<string, ScanRecordRow[]>()
  for (const r of records) {
    const list = byShift.get(r.shift_assignment_id) ?? []
    list.push(r)
    byShift.set(r.shift_assignment_id, list)
  }

  const alerts: MissedAttendanceAlert[] = []
  for (const shift of shifts) {
    const emp = Array.isArray(shift.employees) ? shift.employees[0] : shift.employees
    if (shift.is_on_leave || !emp || emp.active === false) continue

    const { start, end } = getShiftWindow(shift)
    if (now.getTime() - start.getTime() > DAY_MS) continue

    const recs = byShift.get(shift.id) ?? []
    const hasClockIn = recs.some((r) => r.clock_in_at)
    const hasClockOut = recs.some((r) => r.clock_out_at)
    const base = { shift, employeeId: shift.employee_id, employeeName: emp.full_name ?? 'Çalışan' }

    if (!hasClockIn && now.getTime() > start.getTime() + config.missedClockInMins * MINUTE_MS) {
      alerts.push({ ...base, type: 'attendance_missed_clock_in' })
    } else if (hasClockIn && !hasClockOut && now.getTime() > end.getTime() + config.missedClockOutMins * MINUTE_MS) {
      alerts.push({ ...base, type: 'attendance_missed_clock_out' })
    }
  }
  return alerts
}

/**
 * Dün ve bugünkü vardiyaları tarar; okutulmamış giriş/çıkışlar için yöneticilere bildirim gönderir.
 * Aynı vardiya + tip için daha önce bildirim gittiyse tekrar göndermez.
 */
export async function scanMissedAttendance(
  admin: SupabaseClient,
  now: Date = new Date(),
  config: AttendanceAlertConfig = getAttendanceAlertConfig(),
): Promise<{ checked: number; notified: number }> {
  const dates = [turkeyDateString(new Date(now.getTime() - DAY_MS)), turkeyDateString(now)]

  const { data: shifts, error: shiftErr } = await admin
    .from('shift_assignments')
    .select('id, employee_id, work_date, start_time, end_time, is_on_leave, employees(full_name, active)')
    .in('work_date', dates)
  if (shiftErr) throw shiftErr
  if (!shifts || shifts.length === 0) return { checked: 0, notified: 0 }

  const shiftIds = shifts.map((s) => s.id)
  const { data: records, error: recErr } = await admin
    .from('attendance_records')
    .select('shift_assignment_id, clock_in_at, clock_out_at')
    .in('shift_assignment_id', shiftIds)
  if (recErr) throw recErr

  const alerts = findMissedAttendance(
    shifts as ScanShiftRow[],
    (records ?? []) as ScanRecordRow[],
    now,
    config,
  )
  if (alerts.length === 0) return { checked: shifts.length, notified: 0 }

  const existing = await getExistingNotificationKeys(
    admin,
    ['attendance_missed_clock_in', 'attendance_missed_clock_out'],
    alerts.map((a) => a.shift.id),
  )

  let notified = 0
  for (const alert of alerts) {
    if (existing.has(`${alert.type}:${alert.shift.id}`)) continue
    const isIn = alert.type === 'attendance_missed_clock_in'
    try {
      await notifyManagers(
        admin,
        {
          type: alert.type,
          title: isIn ? 'Giriş okutulmadı' : 'Çıkış okutulmadı',
          message: isIn
            ? `${alert.employeeName}, ${shiftLabel(alert.shift)} vardiyası için henüz giriş QR'ı okutmadı.`
            : `${alert.employeeName}, ${shiftLabel(alert.shift)} vardiyası bitti ancak çıkış QR'ı okutulmadı.`,
          related_id: alert.shift.id,
        },
        { excludeEmployeeId: alert.employeeId },
      )
      notified++
    } catch (err) {
      console.error('[attendanceAlerts] eksik okutma bildirimi gönderilemedi:', err)
    }
  }

  return { checked: shifts.length, notified }
}

// ─── Throttle: yönetici bildirim isteklerinden tetikleme ────────

const SCAN_THROTTLE_MS = 60 * 1000
let lastScanAt = 0
let runningScan: Promise<unknown> | null = null

/**
 * scanMissedAttendance'ı en fazla dakikada bir çalıştırır (süreç içi throttle).
 * Cron altyapısı olmadan, yöneticinin bildirim sorgusu sırasında tarama yapılmasını sağlar.
 */
export async function scanMissedAttendanceThrottled(admin: SupabaseClient): Promise<void> {
  if (runningScan) {
    await runningScan
    return
  }
  if (Date.now() - lastScanAt < SCAN_THROTTLE_MS) return
  lastScanAt = Date.now()
  runningScan = scanMissedAttendance(admin)
    .catch((err) => console.error('[attendanceAlerts] tarama hatası:', err))
    .finally(() => { runningScan = null })
  await runningScan
}
