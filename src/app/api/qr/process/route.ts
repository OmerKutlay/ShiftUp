/**
 * POST /api/qr/process
 * QR token'ı doğrular ve attendance kaydını günceller.
 * Tüm kritik doğrulamalar server-side gerçekleşir.
 *
 * Body: { qr_data, employee_id }
 * Response: ProcessQrResponse
 */
import { NextRequest, NextResponse } from 'next/server'
import { validateAndConsumeToken, QrTokenError } from '@/lib/qrTokenService'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { applyAction, AttendanceRuleError, buildFieldPatch } from '@/lib/attendanceStateMachine'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'
import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'
import type { ProcessQrRequest, ProcessQrResponse } from '@/types/qr'
import { QR_TO_ATTENDANCE_ACTION, QR_ACTION_LABELS } from '@/types/qr'
import { format } from 'date-fns'

// Türkiye saatinde HH:mm formatı
function toTurkeyTime(isoString: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(isoString))
  } catch {
    return '--:--'
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ProcessQrRequest>

    // 1. Input validation
    if (!body.qr_data || typeof body.qr_data !== 'string') {
      return NextResponse.json(
        { error: 'qr_data zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }
    if (!body.employee_id || typeof body.employee_id !== 'string') {
      return NextResponse.json(
        { error: 'employee_id zorunludur.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()

    // 2. QR token doğrula + tüket (tek kullanım garantisi)
    const { token: qrToken } = await validateAndConsumeToken(body.qr_data)

    // 3. Employee kontrolü
    const { data: employee, error: empError } = await admin
      .from('employees')
      .select('id, full_name, active')
      .eq('id', body.employee_id)
      .maybeSingle()

    if (empError || !employee) {
      return NextResponse.json(
        { error: 'Çalışan kaydı bulunamadı.', code: 'EMPLOYEE_NOT_FOUND' },
        { status: 404 }
      )
    }

    if (!employee.active) {
      return NextResponse.json(
        { error: 'Pasif çalışan attendance işlemi yapamaz.', code: 'EMPLOYEE_INACTIVE' },
        { status: 403 }
      )
    }

    // 4. QR token'daki employee_id ile body'deki eşleşmeli
    if (qrToken.employee_id !== body.employee_id) {
      return NextResponse.json(
        { error: 'Bu QR kodu bu çalışan için geçerli değil.', code: 'QR_INVALID' },
        { status: 403 }
      )
    }

    // 5. Bugünkü vardiyayı bul
    const today = format(new Date(), 'yyyy-MM-dd')
    const { data: shiftAssignments, error: shiftError } = await admin
      .from('shift_assignments')
      .select('id, employee_id, work_date, start_time, end_time')
      .eq('employee_id', body.employee_id)
      .eq('work_date', today)

    if (shiftError) {
      return NextResponse.json(
        { error: 'Vardiya bilgisi alınamadı.', code: 'DB_ERROR' },
        { status: 500 }
      )
    }

    if (!shiftAssignments || shiftAssignments.length === 0) {
      return NextResponse.json(
        { error: 'Bugün için vardiya bulunamadı.', code: 'NO_SHIFT_TODAY' },
        { status: 404 }
      )
    }

    const shift = shiftAssignments[0]

    // 6. Mevcut attendance kaydını bul
    const { data: existingRecord } = await admin
      .from('attendance_records')
      .select('*')
      .eq('shift_assignment_id', shift.id)
      .neq('status', 'clocked_out')
      .maybeSingle()

    const attendanceAction = QR_TO_ATTENDANCE_ACTION[qrToken.action_type] as AttendanceAction
    const currentStatus: AttendanceStatus = (existingRecord?.status ?? 'shift_waiting') as AttendanceStatus

    // 7. State machine kontrolü
    let nextStatus: AttendanceStatus
    try {
      nextStatus = applyAction(currentStatus, attendanceAction)
    } catch (err) {
      if (err instanceof AttendanceRuleError) {
        return NextResponse.json(
          { error: err.message, code: 'ATTENDANCE_RULE_VIOLATION' },
          { status: 422 }
        )
      }
      throw err
    }

    const now = new Date().toISOString()

    // 8. Attendance kaydı oluştur veya güncelle
    let updatedRecord: AttendanceRecord

    if (attendanceAction === 'clock_in' && !existingRecord) {
      // Yeni kayıt oluştur
      const { data: created, error: createError } = await admin
        .from('attendance_records')
        .insert({
          employee_id: body.employee_id,
          shift_assignment_id: shift.id,
          status: nextStatus,
          clock_in_at: now,
          verification_method: 'qr',
        })
        .select()
        .single()

      if (createError) {
        return NextResponse.json(
          { error: 'Attendance kaydı oluşturulamadı.', code: 'DB_ERROR' },
          { status: 500 }
        )
      }
      updatedRecord = created as AttendanceRecord
    } else if (existingRecord) {
      // Mevcut kaydı güncelle
      const patch = buildFieldPatch(currentStatus, attendanceAction, now)
      const { data: updated, error: updateError } = await admin
        .from('attendance_records')
        .update({ ...patch, verification_method: 'qr' })
        .eq('id', existingRecord.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json(
          { error: 'Attendance kaydı güncellenemedi.', code: 'DB_ERROR' },
          { status: 500 }
        )
      }
      updatedRecord = updated as AttendanceRecord
    } else {
      return NextResponse.json(
        { error: 'Önce giriş yapmalısın.', code: 'ATTENDANCE_RULE_VIOLATION' },
        { status: 422 }
      )
    }

    // 9. Başarılı yanıt
    const actionLabel = QR_ACTION_LABELS[qrToken.action_type]
    const timeStr = toTurkeyTime(now)

    const response: ProcessQrResponse = {
      success: true,
      action_type: qrToken.action_type,
      new_status: updatedRecord.status,
      timestamp: timeStr,
      message: `${actionLabel} başarılı — ${timeStr}`,
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    if (err instanceof QrTokenError) {
      const statusCode = err.code === 'QR_EXPIRED' ? 410 : 400
      return NextResponse.json({ error: err.message, code: err.code }, { status: statusCode })
    }
    console.error('[/api/qr/process]', err)
    return NextResponse.json(
      { error: 'Sunucu hatası oluştu.', code: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
