/**
 * POST /api/qr/process
 *
 * QR token'ı doğrular ve oturumdaki çalışanın devam kaydını günceller.
 *
 * Employee belirleme:
 *   - Kiosk QR ("SU2.…", tek kullanımlık): employee session'dan alınır. Çalışan/vardiya
 *     kontrollerinden sonra atomik tüketilir — aynı anda okutanlardan yalnızca ilki kazanır —
 *     ve yeni kod Realtime Broadcast ile kiosk ekranlarına yayınlanır.
 *   - Klasik QR: token'daki employee_id ile session eşleşmeli (spoofing önlemi)
 *
 * Action belirleme:
 *   - Klasik QR: token'daki action_type bağlayıcıdır (intended_action yok sayılır)
 *   - Kiosk QR: body.intended_action, yoksa duruma göre otomatik
 *
 * Konum: ATTENDANCE_REQUIRE_LOCATION !== 'false' ise (varsayılan) konum zorunludur ve
 * mağaza geofence'i içinde olmalıdır. Ölçülen mesafe/doğruluk denetim için kayda yazılır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { validateAndConsumeToken, QrTokenError } from '@/lib/qrTokenService'
import { isKioskQr, consumeKioskQr, rotateAndBroadcastKioskQr } from '@/lib/kioskQrService'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { AttendanceRuleError } from '@/lib/attendanceStateMachine'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'
import { checkRateLimit } from '@/lib/rateLimiter'
import { requireAuth } from '@/lib/auth'
import type { AttendanceStatus } from '@/types/attendance'
import type { ProcessQrResponse, QrActionType } from '@/types/qr'
import { QR_TO_ATTENDANCE_ACTION, QR_ACTION_LABELS } from '@/types/qr'
import { validateLocationServerSide } from '@/lib/locationService'
import { LocationError } from '@/types/location'
import type { LocationPayload } from '@/types/location'
import {
  findCurrentShift,
  performAttendanceAction,
  suggestNextAction,
  toTurkeyTime,
  NoShiftError,
} from '@/lib/attendanceService'
import { readJson, serverError } from '@/lib/apiErrors'

const ATTENDANCE_TO_QR: Record<AttendanceAction, QrActionType> = {
  clock_in: 'clock_in',
  start_break: 'break_start',
  end_break: 'break_end',
  clock_out: 'clock_out',
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
const VALID_ACTIONS: QrActionType[] = ['clock_in', 'break_start', 'break_end', 'clock_out']

function locationRequired(): boolean {
  return process.env.ATTENDANCE_REQUIRE_LOCATION !== 'false'
}

export async function POST(req: NextRequest) {
  // Authentication zorunlu — employee session'dan alınır
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: sessionEmployee } = auth

  try {
    const body = await readJson<Partial<ProcessBody>>(req)

    if (!body?.qr_data || typeof body.qr_data !== 'string') {
      return NextResponse.json({ error: 'qr_data zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (body.qr_data.length > MAX_QR_DATA_LENGTH) {
      return NextResponse.json({ error: 'QR veri boyutu aşıldı.', code: 'QR_INVALID' }, { status: 400 })
    }

    // Rate limit: session employee bazlı
    const rateCheck = await checkRateLimit(`qr_proc:${sessionEmployee.id}`, PROCESS_RATE_LIMIT, PROCESS_RATE_WINDOW_MS)
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Çok fazla işlem talebi.', code: 'RATE_LIMITED' }, { status: 429 })
    }

    // Konum doğrulaması — token tüketilmeden önce (konum hatasında QR boşa gitmesin)
    let locationFields: Record<string, unknown> = {}
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
      locationFields = {
        location_distance_m: geofenceResult.distance_meters,
        location_accuracy_m: geofenceResult.accuracy_meters,
      }
    } else if (locationRequired()) {
      return NextResponse.json(
        { error: 'Devam işlemi için konum doğrulaması zorunludur.', code: 'LOCATION_REQUIRED' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const employeeId = sessionEmployee.id

    // Kiosk QR: çalışan/vardiya kontrollerinden sonra tüketilir (aşağıda)
    // Klasik QR: doğrula + tek kullanım tüket (atomik)
    const kioskQr = isKioskQr(body.qr_data)
    let classicAction: QrActionType | null = null
    if (!kioskQr) {
      const { token: qrToken } = await validateAndConsumeToken(body.qr_data)
      // Token'daki employee ile session eşleşmeli (başkası adına okutma engeli)
      if (qrToken.employee_id && qrToken.employee_id !== employeeId) {
        return NextResponse.json(
          { error: 'Bu QR kodu size ait değil. Başkası adına okutamazsınız.', code: 'QR_INVALID' },
          { status: 403 }
        )
      }
      classicAction = qrToken.action_type
    }

    // Employee aktiflik kontrolü
    const { data: employee, error: empError } = await admin
      .from('employees')
      .select('id, full_name, active')
      .eq('id', employeeId)
      .maybeSingle()

    if (empError) return serverError('POST /api/qr/process', empError)
    if (!employee) {
      return NextResponse.json({ error: 'Çalışan kaydı bulunamadı.', code: 'EMPLOYEE_NOT_FOUND' }, { status: 404 })
    }
    if (!employee.active) {
      return NextResponse.json({ error: 'Pasif çalışan işlem yapamaz.', code: 'EMPLOYEE_INACTIVE' }, { status: 403 })
    }

    const { shift, record } = await findCurrentShift(admin, employeeId)
    const currentStatus = (record?.status ?? 'shift_waiting') as AttendanceStatus

    // Klasik QR: token'daki aksiyon bağlayıcı. Kiosk: kullanıcı seçimi ya da otomatik.
    let actionType: QrActionType
    if (classicAction) {
      actionType = classicAction
    } else if (body.intended_action && VALID_ACTIONS.includes(body.intended_action)) {
      actionType = body.intended_action
    } else {
      actionType = ATTENDANCE_TO_QR[suggestNextAction(currentStatus)]
    }
    const attendanceAction = QR_TO_ATTENDANCE_ACTION[actionType] as AttendanceAction

    // Kiosk kodunu tüket (ilk okutan kazanır) → yeni kodu ekranlara yayınla
    if (kioskQr) {
      await consumeKioskQr(admin, body.qr_data)
      await rotateAndBroadcastKioskQr(admin)
    }

    const result = await performAttendanceAction({
      admin,
      shift,
      record,
      employeeId,
      employeeName: employee.full_name,
      action: attendanceAction,
      verificationMethod: body.location ? 'qr_location' : 'qr',
      extraFields: locationFields,
    })

    const timeStr = toTurkeyTime(result.recordedAt)
    const response: ProcessQrResponse = {
      success: true,
      action_type: actionType,
      new_status: result.record.status,
      timestamp: timeStr,
      message: result.adjusted
        ? `${QR_ACTION_LABELS[actionType]} başarılı — ${toTurkeyTime(result.scannedAt)}'de okutuldu, ${timeStr} olarak işlendi`
        : `${QR_ACTION_LABELS[actionType]} başarılı — ${timeStr}`,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    if (err instanceof QrTokenError) {
      if (err.code === 'DB_ERROR') return serverError('POST /api/qr/process', err)
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === 'QR_EXPIRED' ? 410 : err.code === 'QR_USED' ? 409 : 400 })
    }
    if (err instanceof LocationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 403 })
    }
    if (err instanceof NoShiftError) {
      return NextResponse.json({ error: err.message, code: 'NO_SHIFT_TODAY' }, { status: 404 })
    }
    if (err instanceof AttendanceRuleError) {
      return NextResponse.json({ error: err.message, code: 'ATTENDANCE_RULE_VIOLATION' }, { status: 422 })
    }
    return serverError('POST /api/qr/process', err)
  }
}
