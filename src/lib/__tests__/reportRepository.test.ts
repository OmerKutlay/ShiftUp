/// <reference types="vitest/globals" />
import { buildReportSummary } from '../reportRepository'
import { mapReportRow } from '../attendanceReportQuery'
import { buildFieldPatch } from '../attendanceStateMachine'
import { workedMinutes } from '../attendanceDurations'
import type { AttendanceReportRow, AttendanceReportStatus } from '@/types/report'

function row(status: AttendanceReportStatus, worked: number | null = null): AttendanceReportRow {
  return {
    record_id: status === 'on_leave' || status === 'upcoming' || status === 'shift_waiting' ? null : 'r',
    employee_id: 'e1',
    full_name: 'Ayşe',
    work_date: '2026-10-01',
    shift_name: null,
    start_time: '09:00:00',
    end_time: '17:00:00',
    status,
    is_on_leave: status === 'on_leave',
    clock_in_at: null,
    break_start_at: null,
    break_end_at: null,
    clock_out_at: null,
    worked_minutes: worked,
    break_minutes: null,
    verification_method: null,
    exception_note: null,
  }
}

describe('buildReportSummary', () => {
  it('izinli ve başlamamış vardiyaları devamsızlık saymaz', () => {
    const [s] = buildReportSummary([
      row('clocked_out', 480),
      row('working'),
      row('shift_waiting'),
      row('on_leave'),
      row('upcoming'),
    ])

    expect(s.total_shifts).toBe(5)
    expect(s.expected_shifts).toBe(3)
    expect(s.attended_shifts).toBe(2)
    expect(s.no_show_count).toBe(1)
    expect(s.on_leave_count).toBe(1)
    expect(s.upcoming_count).toBe(1)
    expect(s.clocked_out_count).toBe(1)
    expect(s.total_worked_minutes).toBe(480)
  })
})

describe('mapReportRow', () => {
  const shift = { employee_id: 'e1', work_date: '2026-10-01', start_time: '09:00:00', end_time: '17:00:00' }
  const now = new Date('2026-10-01T10:00:00+03:00').getTime()

  it('kaydı olmayan izinli vardiya on_leave, başlamamış vardiya upcoming olur', () => {
    expect(mapReportRow({ ...shift, is_on_leave: true, attendance_records: [] }, now).status).toBe('on_leave')
    expect(mapReportRow({ ...shift, start_time: '11:00:00', attendance_records: [] }, now).status).toBe('upcoming')
    expect(mapReportRow({ ...shift, attendance_records: [] }, now).status).toBe('shift_waiting')
  })

  it('önceki molaları net çalışmadan düşer', () => {
    const row = mapReportRow({
      ...shift,
      attendance_records: [{
        id: 'r1',
        status: 'clocked_out',
        clock_in_at: '2026-10-01T06:00:00Z',
        break_start_at: '2026-10-01T11:00:00Z',
        break_end_at: '2026-10-01T11:15:00Z',
        clock_out_at: '2026-10-01T14:00:00Z',
        completed_break_minutes: 30,
      }],
    }, now)
    expect(row.record_id).toBe('r1')
    expect(row.break_minutes).toBe(45)
    expect(row.worked_minutes).toBe(8 * 60 - 45)
  })
})

describe('buildFieldPatch — çoklu mola', () => {
  it('ikinci mola başlarken önceki molayı biriktirir', () => {
    const patch = buildFieldPatch('working_after_break', 'start_break', '2026-10-01T12:00:00Z', {
      break_start_at: '2026-10-01T09:00:00Z',
      break_end_at: '2026-10-01T09:20:00Z',
      completed_break_minutes: 10,
    })
    expect(patch).toEqual({
      status: 'on_break',
      break_start_at: '2026-10-01T12:00:00Z',
      break_end_at: null,
      completed_break_minutes: 30,
    })
  })

  it('ilk molada birikim yapmaz', () => {
    const patch = buildFieldPatch('working', 'start_break', '2026-10-01T12:00:00Z', {
      break_start_at: null,
      break_end_at: null,
      completed_break_minutes: 0,
    })
    expect(patch).toEqual({ status: 'on_break', break_start_at: '2026-10-01T12:00:00Z' })
  })

  it('iki mola sonrası net çalışma doğru hesaplanır', () => {
    expect(workedMinutes({
      clock_in_at: '2026-10-01T06:00:00Z',
      break_start_at: '2026-10-01T12:00:00Z',
      break_end_at: '2026-10-01T12:15:00Z',
      clock_out_at: '2026-10-01T15:00:00Z',
      completed_break_minutes: 30,
    })).toBe(9 * 60 - 45)
  })
})
