/**
 * attendanceRepository — Günlük operasyon ekranının veri katmanı (yalnızca server).
 * Client bileşenleri '@/lib/api/attendance' üzerinden API'yi çağırır.
 */
import { db } from '@/lib/db'
import type { AttendanceRecord, DailyShiftEntry } from '@/types/attendance'

/**
 * Fetch all shift assignments for a given date (YYYY-MM-DD, Europe/Istanbul),
 * joined with employee and attendance data.
 */
export async function fetchDailyShifts(dateStr: string): Promise<DailyShiftEntry[]> {
  const { data: assignments, error: assignError } = await db
    .from('shift_assignments')
    .select(`
      id,
      employee_id,
      shift_template_id,
      work_date,
      start_time,
      end_time,
      is_on_leave,
      created_at,
      updated_at,
      employees (
        id,
        full_name,
        role,
        role_id,
        active,
        created_at,
        updated_at
      )
    `)
    .eq('work_date', dateStr)
    .order('start_time', { ascending: true })

  if (assignError) throw new Error(`Vardiyalar yüklenemedi: ${assignError.message}`)
  if (!assignments || assignments.length === 0) return []

  // Fetch attendance records for these assignments
  const assignmentIds = assignments.map((a) => a.id)
  const { data: records, error: recError } = await db
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
      shift_template_id: assignment.shift_template_id ?? null,
      work_date: assignment.work_date,
      start_time: assignment.start_time,
      end_time: assignment.end_time,
      is_on_leave: assignment.is_on_leave ?? false,
      created_at: assignment.created_at,
      updated_at: assignment.updated_at ?? assignment.created_at,
    },
    attendanceRecord: recordsByShiftId.get(assignment.id) ?? null,
  }))
}

/** Tek bir devam kaydını id ile getirir */
export async function fetchAttendanceRecordByShift(shiftAssignmentId: string): Promise<AttendanceRecord | null> {
  const { data, error } = await db
    .from('attendance_records')
    .select('*')
    .eq('shift_assignment_id', shiftAssignmentId)
    .maybeSingle()
  if (error) throw new Error(`Devam kaydı yüklenemedi: ${error.message}`)
  return (data as AttendanceRecord | null) ?? null
}
