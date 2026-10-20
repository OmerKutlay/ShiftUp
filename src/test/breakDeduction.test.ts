// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { calcEmployeeStats, shiftNetMins } from '@/components/schedule/scheduleHelpers'
import { workedMinutes } from '@/components/daily-attendance/attendanceTime'
import { deductedBreakMinutes, isEarlyExit, roundWorkedMinutes } from '@/lib/attendanceDurations'
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
  const shift = { work_date: '2026-10-05', start_time: '09:00:00', end_time: '18:00:00' }

  it('vardiyayı tamamlayıp mola okutmayandan planlanan mola düşülür', () => {
    expect(workedMinutes(rec({}), now, shift)).toBe(9 * 60 - 60)
  })

  it('uzatılan mola planlanan yerine düşülür, sonuç buçuklu saate yuvarlanır', () => {
    expect(workedMinutes(rec({ completed_break_minutes: 80 }), now, shift)).toBe(7 * 60 + 30)
  })

  it('mola okutmadan erken çıkandan mola düşülmez', () => {
    expect(workedMinutes(rec({ clock_out_at: '2026-10-05T09:11:00Z' }), now, shift)).toBe(3 * 60)
  })

  it('vardiya sürerken yalnızca fiili mola düşülür (yuvarlama yok)', () => {
    expect(workedMinutes(rec({ status: 'working', clock_out_at: null }), now, shift)).toBe(10 * 60)
    expect(workedMinutes(rec({ status: 'working', clock_out_at: null, completed_break_minutes: 13 }), now, shift)).toBe(10 * 60 - 13)
  })
})

describe('mola kuralı ve yuvarlama', () => {
  it('net çalışma en yakın yarım saate yuvarlanır, tam ortası aşağı', () => {
    expect(roundWorkedMinutes(3 * 60 + 11)).toBe(3 * 60)
    expect(roundWorkedMinutes(7 * 60 + 44)).toBe(7 * 60 + 30)
    expect(roundWorkedMinutes(7 * 60 + 45)).toBe(7 * 60 + 30)
    expect(roundWorkedMinutes(7 * 60 + 46)).toBe(8 * 60)
    expect(roundWorkedMinutes(7 * 60 + 59)).toBe(8 * 60)
  })

  it('planlanan bitişten 15 dk’dan az önce çıkış erken çıkış sayılmaz', () => {
    const shift = { work_date: '2026-10-05', start_time: '09:00', end_time: '18:00' }
    const base = { clock_in_at: '2026-10-05T06:00:00Z', break_start_at: null, break_end_at: null, completed_break_minutes: 0 }
    expect(isEarlyExit({ ...base, clock_out_at: '2026-10-05T14:46:00Z' }, shift)).toBe(false) // 17:46
    expect(isEarlyExit({ ...base, clock_out_at: '2026-10-05T14:45:00Z' }, shift)).toBe(true)  // 17:45
    expect(deductedBreakMinutes({ ...base, clock_out_at: '2026-10-05T14:46:00Z' }, shift)).toBe(60)
    expect(deductedBreakMinutes({ ...base, clock_out_at: '2026-10-05T14:45:00Z' }, shift)).toBe(0)
  })

  it('gece yarısını geçen vardiyada bitiş ertesi gündür', () => {
    const shift = { work_date: '2026-10-05', start_time: '22:00', end_time: '06:00' }
    const rec = { clock_in_at: '2026-10-05T19:00:00Z', clock_out_at: '2026-10-06T03:00:00Z', break_start_at: null, break_end_at: null }
    expect(isEarlyExit(rec, shift)).toBe(false)
    expect(deductedBreakMinutes(rec, shift)).toBe(60)
  })
})
