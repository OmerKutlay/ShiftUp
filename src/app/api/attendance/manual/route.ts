/**
 * POST /api/attendance/manual
 * Yönetici, Günlük Operasyon ekranından bir çalışan adına giriş/mola/çıkış işler.
 * Müdür Yardımcısı+. Yönetici kendi devam kaydını bu yolla işleyemez.
 *
 * Body: { shift_assignment_id: string, action: 'clock_in'|'start_break'|'end_break'|'clock_out' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ROLES, forbidden } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { AttendanceRuleError } from '@/lib/attendanceStateMachine'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'
import { performAttendanceAction, type ShiftRow } from '@/lib/attendanceService'
import { fetchAttendanceRecordByShift } from '@/lib/attendanceRepository'
import { badRequest, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { logAudit } from '@/lib/auditLog'

const ACTIONS: AttendanceAction[] = ['clock_in', 'start_break', 'end_break', 'clock_out']

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  const body = await readJson(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')
  const { shift_assignment_id, action } = body
  if (!isUuid(shift_assignment_id)) return badRequest('Geçersiz vardiya.')
  if (!ACTIONS.includes(action as AttendanceAction)) return badRequest('Geçersiz işlem.')

  try {
    const admin = createAdminClient()
    const { data: shift, error } = await admin
      .from('shift_assignments')
      .select('id, employee_id, work_date, start_time, end_time, is_on_leave, employees ( full_name, active )')
      .eq('id', shift_assignment_id)
      .maybeSingle()
    if (error) return serverError('POST /api/attendance/manual', error)
    if (!shift) return notFound('Vardiya bulunamadı.')

    if (shift.employee_id === auth.employee.id) {
      return forbidden('Kendi devam kaydınızı manuel işleyemezsiniz; QR ile okutun.')
    }
    const emp = shift.employees as unknown as { full_name: string; active: boolean } | null
    if (!emp?.active) return badRequest('Pasif çalışan için işlem yapılamaz.')

    const record = await fetchAttendanceRecordByShift(shift.id)
    const result = await performAttendanceAction({
      admin,
      shift: shift as unknown as ShiftRow,
      record,
      employeeId: shift.employee_id,
      employeeName: emp.full_name,
      action: action as AttendanceAction,
      verificationMethod: 'manual',
      applyRounding: false,
      notifyLate: false,
    })

    await logAudit({
      actorId: auth.employee.id,
      action: `attendance.manual.${action}`,
      entityType: 'attendance_record',
      entityId: result.record.id,
      before: record ? { status: record.status } : null,
      after: { status: result.record.status, at: result.recordedAt },
    })

    return NextResponse.json({ record: result.record })
  } catch (err) {
    if (err instanceof AttendanceRuleError) {
      return NextResponse.json({ error: err.message, code: 'ATTENDANCE_RULE_VIOLATION' }, { status: 422 })
    }
    return serverError('POST /api/attendance/manual', err)
  }
}
