import { supabase } from '@/lib/supabase'
import type { AttendanceRecord, DailyShiftEntry } from '@/types/attendance'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'
import { buildFieldPatch, AttendanceRuleError } from '@/lib/attendanceStateMachine'
import { format } from 'date-fns'

/**
 * Fetch all shift assignments for a given date, joined with employee and attendance data.
 */
export async function fetchDailyShifts(date: Date): Promise<DailyShiftEntry[]> {
  const dateStr = format(date, 'yyyy-MM-dd')

  const { data: assignments, error: assignError } = await supabase
    .from('shift_assignments')
    .select(`
      id,
      employee_id,
      work_date,
      start_time,
      end_time,
      created_at,
      employees (
        id,
        full_name,
        role,
        active,
        created_at
      )
    `)
    .eq('work_date', dateStr)
    .order('start_time', { ascending: true })

  if (assignError) throw new Error(`Vardiyalar yüklenemedi: ${assignError.message}`)
  if (!assignments) return []

  // Fetch attendance records for these assignments
  const assignmentIds = assignments.map((a) => a.id)
  const { data: records, error: recError } = await supabase
    .from('attendance_records')
    .select('*')
    .in('shift_assignment_id', assignmentIds)

  if (recError) throw new Error(`Devam kayıtları yüklenemedi: ${recError.message}`)

  const recordsByShiftId = new Map<string, AttendanceRecord>(
    (records ?? []).map((r: AttendanceRecord) => [r.shift_assignment_id, r])
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return assignments.map((assignment: any) => ({
    employee: assignment.employees,
    shiftAssignment: {
      id: assignment.id,
      employee_id: assignment.employee_id,
      work_date: assignment.work_date,
      start_time: assignment.start_time,
      end_time: assignment.end_time,
      created_at: assignment.created_at,
    },
    attendanceRecord: recordsByShiftId.get(assignment.id) ?? null,
  }))
}

/**
 * Create a new attendance record for a shift assignment (clock-in only path).
 * Ensures no duplicate active record exists (enforced by DB unique index too).
 */
export async function createAttendanceRecord(
  shiftAssignmentId: string,
  employeeId: string
): Promise<AttendanceRecord> {
  // Guard: check for existing active record
  const { data: existing } = await supabase
    .from('attendance_records')
    .select('id, status')
    .eq('shift_assignment_id', shiftAssignmentId)
    .neq('status', 'clocked_out')
    .maybeSingle()

  if (existing) {
    throw new AttendanceRuleError('Bu vardiya için zaten aktif bir devam kaydı mevcut.')
  }

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('attendance_records')
    .insert({
      employee_id: employeeId,
      shift_assignment_id: shiftAssignmentId,
      status: 'working',
      clock_in_at: now,
    })
    .select()
    .single()

  if (error) throw new Error(`Giriş kaydı oluşturulamadı: ${error.message}`)
  return data as AttendanceRecord
}

/**
 * Perform an attendance action on an existing record.
 */
export async function performAttendanceAction(
  record: AttendanceRecord,
  action: AttendanceAction
): Promise<AttendanceRecord> {
  const now = new Date().toISOString()
  const patch = buildFieldPatch(record.status, action, now)

  const { data, error } = await supabase
    .from('attendance_records')
    .update(patch)
    .eq('id', record.id)
    .select()
    .single()

  if (error) throw new Error(`Devam durumu güncellenemedi: ${error.message}`)
  return data as AttendanceRecord
}
