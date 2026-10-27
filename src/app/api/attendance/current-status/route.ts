/**
 * GET /api/attendance/current-status
 * Oturumdaki çalışanın şu anki vardiya + devam durumunu ve izinli aksiyonları döner.
 *
 * Her zaman oturum gerektirir. employee_id parametresi yalnızca yöneticiler
 * tarafından, aktif mağazadaki başka bir çalışan için kullanılabilir.
 * "Bugün" Türkiye saatine göredir; gece yarısını geçen vardiyada dünün açık
 * kaydı da bulunur.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { getAllowedActions } from '@/lib/attendanceStateMachine'
import { listBreaks } from '@/lib/attendanceDurations'
import { requireAuth, forbidden, hasRole, MANAGER_ROLES } from '@/lib/auth'
import { findCurrentShift, NoShiftError } from '@/lib/attendanceService'
import { notFound, serverError } from '@/lib/apiErrors'
import { isEmployeeInStore } from '@/lib/storeScope'
import { isUuid } from '@/lib/validation'
import { startTrace, type RequestTrace } from '@/lib/requestTrace'
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
  const trace = startTrace('current_status', req)
  const res = await getCurrentStatus(req, trace)
  trace.end(res.status)
  return res
}

async function getCurrentStatus(req: NextRequest, trace: RequestTrace): Promise<NextResponse> {
  const auth = await requireAuth(req)
  trace.step('auth', { ok: !('response' in auth) })
  if ('response' in auth) return auth.response

  const queryEmployeeId = req.nextUrl.searchParams.get('employee_id')
  let employeeId = auth.employee.id
  if (queryEmployeeId && queryEmployeeId !== auth.employee.id) {
    if (!hasRole(auth.employee.access_level, MANAGER_ROLES)) {
      return forbidden('Yalnızca kendi durumunuzu görüntüleyebilirsiniz.')
    }
    if (!isUuid(queryEmployeeId)) {
      return NextResponse.json({ error: 'Geçersiz çalışan ID.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    employeeId = queryEmployeeId
  }

  try {
    // Başka mağazanın çalışanı görüntülenemez (service role RLS'yi bypass eder)
    if (employeeId !== auth.employee.id && !(await isEmployeeInStore(employeeId, auth.employee.store_id))) {
      return notFound('Çalışan bulunamadı.', 'EMPLOYEE_NOT_FOUND')
    }

    const admin = createAdminClient()

    let found: Awaited<ReturnType<typeof findCurrentShift>>
    try {
      found = await findCurrentShift(admin, employeeId)
      trace.step('shift', { employee_id: employeeId })
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
      breaks: record ? listBreaks(record) : [],
    })
  } catch (err) {
    return serverError('GET /api/attendance/current-status', err)
  }
}
