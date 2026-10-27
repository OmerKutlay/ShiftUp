/**
 * POST /api/qr/process
 *
 * QR token'ı doğrular ve oturumdaki çalışanın devam kaydını günceller.
 *
 * Mağaza: çalışan kendi (ana) mağazasında okutur (home_store_id). Kiosk kodu bu mağazaya ait
 *   olmalıdır — başka mağazanın kodu reddedilir (QR_WRONG_STORE) ve tüketilmez. Konum, çalışanın
 *   mağazasının aktif konumuna göre doğrulanır; yeni kod o mağazanın kanalına yayınlanır.
 *
 * Employee belirleme:
 *   - Kiosk QR ("SU3.…", ekranda dakikada bir yerelde üretilir): employee session'dan alınır.
 *     İmza, mağaza ve zaman penceresi veritabanına gitmeden doğrulanır (kioskQrService); kodu
 *     üreten kiosk oturumu hâlâ yetkili olmalı ve okutanla aynı kişi olmamalıdır.
 *   - Klasik QR: token'daki employee_id ile session eşleşmeli (spoofing önlemi)
 *
 * Action belirleme:
 *   - Klasik QR: token'daki action_type bağlayıcıdır (intended_action yok sayılır)
 *   - Kiosk QR: body.intended_action, yoksa duruma göre otomatik
 *
 * Konum: ATTENDANCE_REQUIRE_LOCATION !== 'false' ise (varsayılan) konum zorunludur ve
 * mağaza geofence'i içinde olmalıdır. Ölçülen mesafe/doğruluk denetim için kayda yazılır.
 * Konum tarayıcıdan gelir ve sahtelenebilir; bu yüzden asıl "mağazadayım" kanıtı, yalnızca
 * mağazadaki ekranda görünen ve ~1,5 dakikada geçersizleşen kiosk kodudur.
 */
import { isEffectivelyActive } from '@/lib/employment'
import { NextRequest, NextResponse } from 'next/server'
import { validateAndConsumeToken, QrTokenError } from '@/lib/qrTokenService'
import { verifyKioskQr, verifyKioskIssuer } from '@/lib/kioskQrService'
import { isKioskQr } from '@/lib/kioskQrCode'
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
import { startTrace, type RequestTrace } from '@/lib/requestTrace'

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
/** Gerçek bir GPS ölçümünün doğruluğu bu aralıktadır; dışı bozuk veya elle yazılmış veridir */
const MAX_REPORTED_ACCURACY_M = 100_000

function locationRequired(): boolean {
  return process.env.ATTENDANCE_REQUIRE_LOCATION !== 'false'
}

export async function POST(req: NextRequest) {
  const trace = startTrace('qr_process', req)
  const res = await processQr(req, trace)
  trace.end(res.status)
  return res
}

async function processQr(req: NextRequest, trace: RequestTrace): Promise<NextResponse> {
  // Authentication zorunlu — employee session'dan alınır
  const auth = await requireAuth(req)
  trace.step('auth', { ok: !('response' in auth) })
  if ('response' in auth) return auth.response
  const { employee: sessionEmployee } = auth
  // Çalışan kendi mağazasında okutur; kiosk kodu, geofence ve yayın bu mağazaya göre çalışır
  const storeId = sessionEmployee.home_store_id

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
    trace.step('rate_limit', { employee_id: sessionEmployee.id, allowed: rateCheck.allowed })
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Çok fazla işlem talebi.', code: 'RATE_LIMITED' }, { status: 429 })
    }

    // Eski (tek kullanımlık) kiosk kodu: ekran güncellenmemiş
    if (body.qr_data.startsWith('SU2.')) {
      return NextResponse.json(
        { error: 'Kiosk ekranı güncel değil. Kiosk sayfasını yenileyip yeni kodu okutun.', code: 'QR_INVALID' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const employeeId = sessionEmployee.id

    // Kiosk kodu: imza / mağaza / süre veritabanına gitmeden, ardından kodu üreten oturum doğrulanır
    const kioskQr = isKioskQr(body.qr_data)
    if (kioskQr) {
      const { issuerId } = await verifyKioskQr(body.qr_data, { storeId, scannerId: employeeId })
      await verifyKioskIssuer(admin, issuerId, storeId)
      trace.step('kiosk_verify')
    }

    // Konum doğrulaması — klasik token tüketilmeden önce (konum hatasında QR boşa gitmesin)
    let locationFields: Record<string, unknown> = {}
    if (body.location) {
      const loc = body.location
      if (
        !Number.isFinite(loc.latitude) ||
        !Number.isFinite(loc.longitude) ||
        !Number.isFinite(loc.accuracy) ||
        loc.accuracy <= 0 ||
        loc.accuracy > MAX_REPORTED_ACCURACY_M
      ) {
        return NextResponse.json({ error: 'Konum verisi hatalı.', code: 'LOCATION_VALIDATION_FAILED' }, { status: 400 })
      }
      if (loc.latitude < -90 || loc.latitude > 90 || loc.longitude < -180 || loc.longitude > 180) {
        return NextResponse.json({ error: 'Geçersiz GPS koordinatları.', code: 'LOCATION_VALIDATION_FAILED' }, { status: 400 })
      }
      const geofenceResult = await validateLocationServerSide(
        { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy },
        storeId
      )
      trace.step('geofence', { allowed: geofenceResult.allowed })
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

    // Klasik QR: doğrula + tek kullanım tüket (atomik)
    let classicAction: QrActionType | null = null
    if (!kioskQr) {
      const { token: qrToken } = await validateAndConsumeToken(body.qr_data, { employeeId, storeId })
      trace.step('classic_consume')
      // Token'daki employee ile session eşleşmeli (başkası adına okutma engeli)
      if (qrToken.employee_id && qrToken.employee_id !== employeeId) {
        return NextResponse.json(
          { error: 'Bu QR kodu size ait değil. Başkası adına okutamazsınız.', code: 'QR_INVALID' },
          { status: 403 }
        )
      }
      // Mağazaya bağlı üretilmiş kod başka mağazada geçerli değildir
      if (qrToken.store_id && qrToken.store_id !== storeId) {
        return NextResponse.json(
          { error: 'Bu QR kodu başka bir mağazaya ait.', code: 'QR_WRONG_STORE' },
          { status: 403 }
        )
      }
      classicAction = qrToken.action_type
    }

    // Employee aktiflik kontrolü
    const { data: employee, error: empError } = await admin
      .from('employees')
      .select('id, full_name, active, termination_date')
      .eq('id', employeeId)
      .maybeSingle()

    trace.step('employee', { kiosk: kioskQr })
    if (empError) return serverError('POST /api/qr/process', empError)
    if (!employee) {
      return NextResponse.json({ error: 'Çalışan kaydı bulunamadı.', code: 'EMPLOYEE_NOT_FOUND' }, { status: 404 })
    }
    if (!isEffectivelyActive(employee)) {
      return NextResponse.json({ error: 'Pasif çalışan işlem yapamaz.', code: 'EMPLOYEE_INACTIVE' }, { status: 403 })
    }

    const { shift, record } = await findCurrentShift(admin, employeeId)
    // Mağaza değiştiren çalışanın eski mağazadaki (ör. gece yarısını geçen) vardiyası bu mağazanın
    // kiosk'u ve konumuyla kapatılamaz
    if (shift.store_id !== storeId) {
      return NextResponse.json(
        { error: 'Bu vardiya başka bir mağazaya ait; o mağazanın kiosk kodunu okutun.', code: 'SHIFT_IN_OTHER_STORE' },
        { status: 409 }
      )
    }
    const currentStatus = (record?.status ?? 'shift_waiting') as AttendanceStatus
    trace.step('shift', { attendance_status: currentStatus })

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
    trace.step('attendance', { action: actionType, adjusted: result.adjusted })

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
    trace.step('error', { error: err instanceof Error ? err.name : 'unknown', code: (err as { code?: string } | null)?.code ?? null })
    if (err instanceof QrTokenError) {
      if (err.code === 'DB_ERROR') return serverError('POST /api/qr/process', err)
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === 'QR_EXPIRED' ? 410 : err.code === 'QR_USED' ? 409 : err.code === 'QR_WRONG_STORE' || err.code === 'QR_NOT_OWNER' || err.code === 'QR_SELF_ISSUED' ? 403 : 400 })
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
