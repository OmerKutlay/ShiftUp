/**
 * POST /api/qr/process
 *
 * QR token'ı doğrular ve attendance kaydını günceller.
 *
 * Employee belirleme:
 *   - Kiosk QR (isKiosk=true): employee session'dan alınır
 *   - Klasik QR: token'daki employee_id ile session eşleşmeli (spoofing önlemi)
 *
 * Action belirleme (öncelik sırası):
 *   1. Body'deki intended_action (kullanıcı amaç seçti → buton tabanlı akış)
 *   2. Klasik QR: token'daki action_type
 *   3. Kiosk QR fallback: state machine'den otomatik
 *
 * FAZ 8: Rate limiting, body size guard, konum doğrulaması.
 */
import { NextRequest, NextResponse } from 'next/server'
import { validateAndConsumeToken, QrTokenError } from '@/lib/qrTokenService'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { applyAction, AttendanceRuleError, buildFieldPatch } from '@/lib/attendanceStateMachine'
import { checkRateLimit } from '@/lib/rateLimiter'
import { requireAuth } from '@/lib/auth'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'
import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'
import type { ProcessQrResponse } from '@/types/qr'
import type { QrActionType } from '@/types/qr'
import { QR_TO_ATTENDANCE_ACTION, QR_ACTION_LABELS } from '@/types/qr'
import { validateLocationServerSide } from '@/lib/locationService'
import { LocationError } from '@/types/location'
import type { LocationPayload } from '@/types/location'
import { format } from 'date-fns'
import { notifyIfLateAttendance } from '@/lib/attendanceAlerts'
import { resolveRecordedTime } from '@/lib/attendanceRounding'

function toTurkeyTime(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(isoString))
  } catch { return '--:--' }
}

/**
 * Mevcut attendance durumuna göre bir sonraki mantıklı aksiyonu belirler.
 * Kiosk QR'da action_type yoktur — buradan otomatik hesaplanır.
 */
function suggestAction(currentStatus: AttendanceStatus): QrActionType {
  switch (currentStatus) {
    case 'shift_waiting': return 'clock_in'
    case 'working': return 'break_start'
    case 'on_break': return 'break_end'
    case 'working_after_break': return 'clock_out'
    default: return 'clock_in'
  }
}

interface ProcessBody {
  qr_data: string
  location?: LocationPayload
  /** Kullanıcının amaç seçim ekranında seçtiği aksiyon (kiosk buton akışı) */
  intended_action?: QrActionType
}

const PROCESS_RATE_LIMIT = 30
const PROCESS_RATE_WINDOW_MS = 60 * 1000
const MAX_QR_DATA_LENGTH = 2048

export async function POST(req: NextRequest) {
  // Authentication zorunlu — employee session'dan alınır
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: sessionEmployee } = auth

  try {
    const body = (await req.json()) as Partial<ProcessBody>

    if (!body.qr_data || typeof body.qr_data !== 'string') {
      return NextResponse.json({ error: 'qr_data zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (body.qr_data.length > MAX_QR_DATA_LENGTH) {
      return NextResponse.json({ error: 'QR veri boyutu aşıldı.', code: 'QR_INVALID' }, { status: 400 })
    }

    // Rate limit: session employee bazlı
    const rateLimitKey = `qr_proc:${sessionEmployee.id}`
    const rateCheck = checkRateLimit(rateLimitKey, PROCESS_RATE_LIMIT, PROCESS_RATE_WINDOW_MS)
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Çok fazla işlem talebi.', code: 'RATE_LIMITED' }, { status: 429 })
    }

    const admin = createAdminClient()

    // QR token doğrula + tek kullanım tüket
    const { token: qrToken, isKiosk } = await validateAndConsumeToken(body.qr_data)

    // Kullanılacak employee_id → her zaman session'dan
    const employeeId = sessionEmployee.id

    // Klasik QR'da token'daki employee ile session eşleşmeli (başkası adına okutma engeli)
    if (!isKiosk && qrToken.employee_id && qrToken.employee_id !== employeeId) {
      return NextResponse.json(
        { error: 'Bu QR kodu size ait değil. Başkası adına okutamazsınız.', code: 'QR_INVALID' },
        { status: 403 }
      )
    }

    // Employee aktiflik kontrolü
    const { data: employee, error: empError } = await admin
      .from('employees')
      .select('id, full_name, active')
      .eq('id', employeeId)
      .maybeSingle()

    if (empError || !employee) {
      return NextResponse.json({ error: 'Çalışan kaydı bulunamadı.', code: 'EMPLOYEE_NOT_FOUND' }, { status: 404 })
    }
    if (!employee.active) {
      return NextResponse.json({ error: 'Pasif çalışan işlem yapamaz.', code: 'EMPLOYEE_INACTIVE' }, { status: 403 })
    }

    // Konum doğrulaması
    if (body.location) {
      const loc = body.location
      if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number' || typeof loc.accuracy !== 'number') {
        return NextResponse.json({ error: 'Konum verisi hatalı.', code: 'LOCATION_VALIDATION_FAILED' }, { status: 400 })
      }
      if (loc.latitude < -90 || loc.latitude > 90 || loc.longitude < -180 || loc.longitude > 180) {
        return NextResponse.json({ error: 'Geçersiz GPS koordinatları.', code: 'LOCATION_VALIDATION_FAILED' }, { status: 400 })
      }
      const geofenceResult = await validateLocationServerSide({ latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy })
      if (!geofenceResult.allowed) {
        return NextResponse.json(
          { error: geofenceResult.message, code: 'LOCATION_OUT_OF_RANGE', distance_meters: geofenceResult.distance_meters },
          { status: 403 }
        )
      }
    }

    // Bugünkü vardiyayı bul
    const today = format(new Date(), 'yyyy-MM-dd')
    const { data: shiftAssignments, error: shiftError } = await admin
      .from('shift_assignments')
      .select('id, employee_id, work_date, start_time, end_time')
      .eq('employee_id', employeeId)
      .eq('work_date', today)

    if (shiftError) {
      return NextResponse.json({ error: 'Vardiya bilgisi alınamadı.', code: 'DB_ERROR' }, { status: 500 })
    }
    if (!shiftAssignments || shiftAssignments.length === 0) {
      return NextResponse.json({ error: 'Bugün için vardiya bulunamadı.', code: 'NO_SHIFT_TODAY' }, { status: 404 })
    }

    const shift = shiftAssignments[0]

    // Mevcut attendance kaydı
    const { data: existingRecord } = await admin
      .from('attendance_records')
      .select('*')
      .eq('shift_assignment_id', shift.id)
      .neq('status', 'clocked_out')
      .maybeSingle()

    const currentStatus: AttendanceStatus = (existingRecord?.status ?? 'shift_waiting') as AttendanceStatus

    // Action type belirleme — öncelik sırası:
    // 1. Body'deki intended_action (kullanıcı amaç seçtiyse)
    // 2. Klasik QR: token'daki action_type
    // 3. Kiosk QR fallback: state machine otomatik
    const VALID_ACTIONS: QrActionType[] = ['clock_in', 'break_start', 'break_end', 'clock_out']
    const intendedAction =
      body.intended_action && VALID_ACTIONS.includes(body.intended_action)
        ? body.intended_action
        : null

    const actionType: QrActionType = intendedAction
      ?? (isKiosk ? suggestAction(currentStatus) : (qrToken.action_type ?? suggestAction(currentStatus)))

    const attendanceAction = QR_TO_ATTENDANCE_ACTION[actionType] as AttendanceAction

    // State machine kontrolü
    let nextStatus: AttendanceStatus
    try {
      nextStatus = applyAction(currentStatus, attendanceAction)
    } catch (err) {
      if (err instanceof AttendanceRuleError) {
        return NextResponse.json({ error: err.message, code: 'ATTENDANCE_RULE_VIOLATION' }, { status: 422 })
      }
      throw err
    }

    const now = new Date().toISOString()
    // Giriş/çıkış saati tolerans kuralına göre yuvarlanır (bkz. attendanceRounding)
    const recorded = resolveRecordedTime(shift, attendanceAction, new Date(now), existingRecord)
    const verificationMethod = body.location ? 'qr_location' : 'qr'

    // Attendance kaydı oluştur veya güncelle
    let updatedRecord: AttendanceRecord

    if (attendanceAction === 'clock_in' && !existingRecord) {
      const { data: created, error: createError } = await admin
        .from('attendance_records')
        .insert({
          employee_id: employeeId,
          shift_assignment_id: shift.id,
          status: nextStatus,
          clock_in_at: recorded.recordedAt,
          verification_method: verificationMethod,
          ...(recorded.exceptionNote ? { exception_note: recorded.exceptionNote } : {}),
        })
        .select()
        .single()

      if (createError) {
        return NextResponse.json({ error: 'Attendance kaydı oluşturulamadı.', code: 'DB_ERROR' }, { status: 500 })
      }
      updatedRecord = created as AttendanceRecord
    } else if (existingRecord) {
      const patch = buildFieldPatch(currentStatus, attendanceAction, recorded.recordedAt, existingRecord)
      const { data: updated, error: updateError } = await admin
        .from('attendance_records')
        .update({
          ...patch,
          verification_method: verificationMethod,
          ...(recorded.exceptionNote ? { exception_note: recorded.exceptionNote } : {}),
        })
        .eq('id', existingRecord.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: 'Attendance kaydı güncellenemedi.', code: 'DB_ERROR' }, { status: 500 })
      }
      updatedRecord = updated as AttendanceRecord
    } else {
      return NextResponse.json({ error: 'Önce giriş yapmalısın.', code: 'ATTENDANCE_RULE_VIOLATION' }, { status: 422 })
    }

    // Geç giriş / geç çıkış → yöneticilere bildirim (hata attendance işlemini bozmaz)
    if (attendanceAction === 'clock_in' || attendanceAction === 'clock_out') {
      await notifyIfLateAttendance(admin, {
        employeeId,
        employeeName: employee.full_name,
        shift,
        action: attendanceAction,
        at: new Date(now),
        recordedAt: new Date(recorded.recordedAt),
      })
    }

    const timeStr = toTurkeyTime(recorded.recordedAt)
    const response: ProcessQrResponse = {
      success: true,
      action_type: actionType,
      new_status: updatedRecord.status,
      timestamp: timeStr,
      message: recorded.exceptionNote
        ? `${QR_ACTION_LABELS[actionType]} başarılı — ${toTurkeyTime(now)}'de okutuldu, ${timeStr} olarak işlendi`
        : `${QR_ACTION_LABELS[actionType]} başarılı — ${timeStr}`,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    if (err instanceof QrTokenError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === 'QR_EXPIRED' ? 410 : 400 })
    }
    if (err instanceof LocationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 403 })
    }
    console.error('[/api/qr/process]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
