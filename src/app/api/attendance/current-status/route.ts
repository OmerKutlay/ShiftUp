/**
 * GET /api/attendance/current-status
 * Oturumdaki çalışanın şu anki vardiya + devam durumunu ve izinli aksiyonları döner.
 *
 * Her zaman oturum gerektirir. employee_id parametresi yalnızca yöneticiler
 * tarafından başka bir çalışan için kullanılabilir.
 * "Bugün" Türkiye saatine göredir; gece yarısını geçen vardiyada dünün açık
 * kaydı da bulunur.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { getAllowedActions } from '@/lib/attendanceStateMachine'
import { requireAuth, forbidden, hasRole, MANAGER_ROLES } from '@/lib/auth'
import { findCurrentShift, NoShiftError } from '@/lib/attendanceService'
import { serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import type { AttendanceStatus } from '@/types/attendance'
import type { QrActionType } from '@/types/qr'

// attendance action → QR action mapping
const ATTENDANCE_TO_QR_ACTION: Record<string, QrActionType> = {
  clock_in: 'clock_in',
  start_break: 'break_start',
  end_break: 'break_end',
  clock_out: 'clock_out',
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  const queryEmployeeId = req.nextUrl.searchParams.get('employee_id')
  let employeeId = auth.employee.id
  if (queryEmployeeId && queryEmployeeId !== auth.employee.id) {
    if (!hasRole(auth.employee.role_name, MANAGER_ROLES)) {
      return forbidden('Yalnızca kendi durumunuzu görüntüleyebilirsiniz.')
    }
    if (!isUuid(queryEmployeeId)) {
      return NextResponse.json({ error: 'Geçersiz çalışan ID.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    employeeId = queryEmployeeId
  }

  try {
    const admin = createAdminClient()

    let found: Awaited<ReturnType<typeof findCurrentShift>>
    try {
      found = await findCurrentShift(admin, employeeId)
    } catch (err) {
      if (err instanceof NoShiftError) {
        return NextResponse.json({
          has_shift: false,
          current_status: null,
          suggested_action: null,
          allowed_actions: [],
        })
      }
      throw err
    }

    const { shift, record } = found
    const currentStatus: AttendanceStatus = (record?.status ?? 'shift_waiting') as AttendanceStatus

    const allowedQrActions: QrActionType[] = getAllowedActions(currentStatus)
      .map((a) => ATTENDANCE_TO_QR_ACTION[a])
      .filter(Boolean) as QrActionType[]

    // İlk önerilen action — öncelik sırası: clock_in > clock_out > break_start > break_end
    const PRIORITY: QrActionType[] = ['clock_in', 'clock_out', 'break_start', 'break_end']
    const suggestedAction = PRIORITY.find((a) => allowedQrActions.includes(a)) ?? allowedQrActions[0] ?? null

    return NextResponse.json({
      has_shift: true,
      shift_id: shift.id,
      shift_date: shift.work_date,
      shift_start: shift.start_time,
      shift_end: shift.end_time,
      current_status: currentStatus,
      suggested_action: suggestedAction,
      allowed_actions: allowedQrActions,
    })
  } catch (err) {
    return serverError('GET /api/attendance/current-status', err)
  }
}
