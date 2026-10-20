// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { calcEmployeeStats, shiftNetMins } from '@/components/schedule/scheduleHelpers'
import { workedMinutes } from '@/components/daily-attendance/attendanceTime'
import type { AttendanceRecord } from '@/types/attendance'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'

const assignment = (worked_minutes?: number | null) => ({
  id: 'a1', employee_id: 'e1', shift_template_id: null, work_date: '2026-10-05',
  start_time: '09:00:00', end_time: '18:00:00', is_on_leave: false, created_at: '', updated_at: '',
  shift_templates: null, employees: null, worked_minutes,
}) as ShiftAssignmentWithDetails

describe('haftalık plan — gerçekleşen net süre', () => {
  it('çıkış yapılmamış vardiyada planlanan net, yapılmışsa gerçekleşen net sayılır', () => {
    expect(shiftNetMins(assignment())).toBe(8 * 60)
    expect(shiftNetMins(assignment(7 * 60 + 35))).toBe(7 * 60 + 35)
    const stats = calcEmployeeStats([assignment(7 * 60 + 35)], ['2026-10-05'])
    expect(stats.totalMins).toBe(7 * 60 + 35)
  })
})

describe('günlük devam — net çalışma', () => {
  const rec = (patch: Partial<AttendanceRecord>): AttendanceRecord => ({
    id: 'r1', employee_id: 'e1', shift_assignment_id: 'a1', status: 'clocked_out',
    clock_in_at: '2026-10-05T06:00:00Z', break_start_at: null, break_end_at: null,
    clock_out_at: '2026-10-05T15:00:00Z', completed_break_minutes: 0,
    verification_method: null, exception_note: null, created_at: '', updated_at: '', ...patch,
  })
  const now = new Date('2026-10-05T16:00:00Z').getTime()

  it('çıkışta mola okutulmadıysa planlanan mola düşülür', () => {
    expect(workedMinutes(rec({}), now, 60)).toBe(9 * 60 - 60)
  })

  it('uzatılan mola planlanan yerine düşülür', () => {
    expect(workedMinutes(rec({ completed_break_minutes: 80 }), now, 60)).toBe(9 * 60 - 80)
  })

  it('vardiya sürerken yalnızca fiili mola düşülür', () => {
    expect(workedMinutes(rec({ status: 'working', clock_out_at: null }), now, 60)).toBe(10 * 60)
  })
})
