/**
 * GET /api/attendance/current-status
 * Çalışanın bugünkü vardiya + attendance durumunu ve önerilen next action'ı döner.
 *
 * employee_id querystring parametresi opsiyoneldir.
 * Verilmezse authenticated session'daki çalışan kullanılır (buton tabanlı devam takibi).
 * Verilirse (kiosk ekran modu) o çalışan için sorgu yapılır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { getAllowedActions } from '@/lib/attendanceStateMachine'
import { requireAuth } from '@/lib/auth'
import type { AttendanceStatus } from '@/types/attendance'
import type { QrActionType } from '@/types/qr'
import { format } from 'date-fns'

// attendance action → QR action mapping
const ATTENDANCE_TO_QR_ACTION: Record<string, QrActionType> = {
  clock_in: 'clock_in',
  start_break: 'break_start',
  end_break: 'break_end',
  clock_out: 'clock_out',
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const queryEmployeeId = searchParams.get('employee_id')

  // employee_id parametresi yoksa session'dan al
  let employeeId = queryEmployeeId
  if (!employeeId) {
    const auth = await requireAuth(req)
    if ('response' in auth) return auth.response
    employeeId = auth.employee.id
  }

  try {
    const admin = createAdminClient()
    const today = format(new Date(), 'yyyy-MM-dd')

    // Bugünkü vardiyayı bul
    const { data: shifts, error: shiftError } = await admin
      .from('shift_assignments')
      .select('id, start_time, end_time')
      .eq('employee_id', employeeId)
      .eq('work_date', today)
      .limit(1)

    if (shiftError) {
      return NextResponse.json(
        { error: 'Vardiya sorgulanamadı.', code: 'DB_ERROR' },
        { status: 500 }
      )
    }

    if (!shifts || shifts.length === 0) {
      return NextResponse.json({
        has_shift: false,
        current_status: null,
        suggested_action: null,
        allowed_actions: [],
      })
    }

    const shift = shifts[0]

    // Mevcut attendance kaydını bul
    const { data: record } = await admin
      .from('attendance_records')
      .select('status')
      .eq('shift_assignment_id', shift.id)
      .neq('status', 'clocked_out')
      .maybeSingle()

    const currentStatus: AttendanceStatus = (record?.status ?? 'shift_waiting') as AttendanceStatus
    const allowedAttendanceActions = getAllowedActions(currentStatus)

    // Attendance action'larını QR action'lara dönüştür
    const allowedQrActions: QrActionType[] = allowedAttendanceActions
      .map((a) => ATTENDANCE_TO_QR_ACTION[a])
      .filter(Boolean) as QrActionType[]

    // İlk önerilen action — öncelik sırası: clock_in > clock_out > break_start > break_end
    const PRIORITY: QrActionType[] = ['clock_in', 'clock_out', 'break_start', 'break_end']
    const suggestedAction = PRIORITY.find((a) => allowedQrActions.includes(a)) ?? allowedQrActions[0] ?? null

    return NextResponse.json({
      has_shift: true,
      shift_id: shift.id,
      shift_start: shift.start_time,
      shift_end: shift.end_time,
      current_status: currentStatus,
      suggested_action: suggestedAction,
      allowed_actions: allowedQrActions,
    })
  } catch (err) {
    console.error('[/api/attendance/current-status]', err)
    return NextResponse.json(
      { error: 'Sunucu hatası.', code: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
