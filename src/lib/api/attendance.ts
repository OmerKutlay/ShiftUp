/**
 * Client tarafı günlük operasyon API'si — /api/attendance/daily, /api/attendance/manual
 */
import { apiFetch } from './http'
import type { AttendanceRecord, DailyShiftEntry } from '@/types/attendance'
import type { AttendanceAction } from '@/lib/attendanceStateMachine'

/** Bugünün (Europe/Istanbul) vardiyaları + devam kayıtları */
export async function fetchDailyShifts(): Promise<{ date: string; entries: DailyShiftEntry[] }> {
  return apiFetch<{ date: string; entries: DailyShiftEntry[] }>('/api/attendance/daily')
}

/** Yönetici tarafından manuel devam işlemi (giriş/mola/çıkış) */
export async function performManualAttendanceAction(
  shiftAssignmentId: string,
  action: AttendanceAction
): Promise<AttendanceRecord> {
  const { record } = await apiFetch<{ record: AttendanceRecord }>('/api/attendance/manual', {
    method: 'POST',
    body: { shift_assignment_id: shiftAssignmentId, action },
  })
  return record
}
