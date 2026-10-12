/**
 * POST /api/attendance/action
 *
 * Buton tabanlı devam takibi için tek-adım endpoint.
 * QR token döngüsü olmadan, doğrudan authenticated session üzerinden aksiyonu uygular.
 *
 * Body: { action_type: QrActionType }
 *
 * Kurallar:
 *   - Employee session'dan alınır, body'den kabul edilmez.
 *   - Molada iken (on_break) clock_out isteği reddedilir.
 *   - State machine geçersiz her geçişi reddeder.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { applyAction, AttendanceRuleError, buildFieldPatch } from '@/lib/attendanceStateMachine'
import { checkRateLimit } from '@/lib/rateLimiter'
import { requireAuth } from '@/lib/auth'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'
import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'
import type { QrActionType } from '@/types/qr'
import { QR_TO_ATTENDANCE_ACTION, QR_ACTION_LABELS } from '@/types/qr'
import { format } from 'date-fns'
import { notifyIfLateAttendance } from '@/lib/attendanceAlerts'
import { resolveRecordedTime } from '@/lib/attendanceRounding'

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

const VALID_ACTIONS: QrActionType[] = ['clock_in', 'break_start', 'break_end', 'clock_out']
const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60 * 1000

interface ActionBody {
  action_type: QrActionType
}

export async function POST(req: NextRequest) {
  // Authentication zorunlu
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: sessionEmployee } = auth

  try {
    const body = (await req.json()) as Partial<ActionBody>

    if (!body.action_type || !VALID_ACTIONS.includes(body.action_type)) {
      return NextResponse.json(
        { error: 'Geçersiz action_type.', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const actionType = body.action_type

    // Rate limit: employee bazlı
    const rateLimitKey = `attendance_action:${sessionEmployee.id}`
    const rateCheck = checkRateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Çok fazla işlem talebi. Lütfen bekleyin.', code: 'RATE_LIMITED' },
        { status: 429 }
      )
    }

    const admin = createAdminClient()
    const employeeId = sessionEmployee.id

    // Employee aktiflik kontrolü
    const { data: employee, error: empError } = await admin
      .from('employees')
      .select('id, full_name, active')
      .eq('id', employeeId)
      .maybeSingle()

    if (empError || !employee) {
      return NextResponse.json(
        { error: 'Çalışan kaydı bulunamadı.', code: 'EMPLOYEE_NOT_FOUND' },
        { status: 404 }
      )
    }
    if (!employee.active) {
      return NextResponse.json(
        { error: 'Pasif çalışan işlem yapamaz.', code: 'EMPLOYEE_INACTIVE' },
        { status: 403 }
      )
    }

    // Bugünkü vardiyayı bul
    const today = format(new Date(), 'yyyy-MM-dd')
    const { data: shiftAssignments, error: shiftError } = await admin
      .from('shift_assignments')
      .select('id, employee_id, work_date, start_time, end_time')
      .eq('employee_id', employeeId)
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

    // Mevcut attendance kaydı
    const { data: existingRecord } = await admin
      .from('attendance_records')
      .select('*')
      .eq('shift_assignment_id', shift.id)
      .neq('status', 'clocked_out')
      .maybeSingle()

    const currentStatus: AttendanceStatus = (existingRecord?.status ?? 'shift_waiting') as AttendanceStatus

    // Molada iken çıkış — özel kontrol ve açık hata mesajı
    if (actionType === 'clock_out' && currentStatus === 'on_break') {
      return NextResponse.json(
        {
          error: 'Molada iken çıkış yapılamaz. Önce moladan dönün.',
          code: 'ATTENDANCE_RULE_VIOLATION',
        },
        { status: 422 }
      )
    }

    const attendanceAction = QR_TO_ATTENDANCE_ACTION[actionType] as AttendanceAction

    // State machine geçişini doğrula
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
    // Giriş/çıkış saati tolerans kuralına göre yuvarlanır (bkz. attendanceRounding)
    const recorded = resolveRecordedTime(shift, attendanceAction, new Date(now), existingRecord)

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
          verification_method: 'button',
          ...(recorded.exceptionNote ? { exception_note: recorded.exceptionNote } : {}),
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
      const patch = buildFieldPatch(currentStatus, attendanceAction, recorded.recordedAt, existingRecord)
      const { data: updated, error: updateError } = await admin
        .from('attendance_records')
        .update({
          ...patch,
          verification_method: 'button',
          ...(recorded.exceptionNote ? { exception_note: recorded.exceptionNote } : {}),
        })
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
    return NextResponse.json({
      success: true,
      action_type: actionType,
      new_status: updatedRecord.status,
      timestamp: timeStr,
      message: recorded.exceptionNote
        ? `${QR_ACTION_LABELS[actionType]} başarılı — ${toTurkeyTime(now)}'de okutuldu, ${timeStr} olarak işlendi`
        : `${QR_ACTION_LABELS[actionType]} başarılı — ${timeStr}`,
    })
  } catch (err) {
    console.error('[POST /api/attendance/action]', err)
    return NextResponse.json(
      { error: 'Sunucu hatası.', code: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
