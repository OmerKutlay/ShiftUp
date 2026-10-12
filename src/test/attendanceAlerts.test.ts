import { describe, it, expect } from 'vitest'
import {
  findMissedAttendance,
  getShiftWindow,
  turkeyDateString,
  DEFAULT_ATTENDANCE_ALERT_CONFIG as CONFIG,
} from '@/lib/attendanceAlerts'

const emp = { full_name: 'Ayşe Yılmaz', active: true }

function shift(overrides: Partial<{ id: string; work_date: string; start_time: string; end_time: string; is_on_leave: boolean }> = {}) {
  return {
    id: 's1',
    employee_id: 'e1',
    work_date: '2026-10-12',
    start_time: '09:00:00',
    end_time: '17:00:00',
    is_on_leave: false,
    employees: emp,
    ...overrides,
  }
}

// Türkiye saati (UTC+3) → Date
const tr = (iso: string) => new Date(`${iso}+03:00`)

describe('getShiftWindow', () => {
  it('vardiya saatlerini Türkiye saatine göre UTC anına çevirir', () => {
    const { start, end } = getShiftWindow(shift())
    expect(start.toISOString()).toBe('2026-10-12T06:00:00.000Z')
    expect(end.toISOString()).toBe('2026-10-12T14:00:00.000Z')
  })

  it('gece yarısını geçen vardiyada bitişi ertesi güne atar', () => {
    const { end } = getShiftWindow(shift({ start_time: '22:00', end_time: '06:00' }))
    expect(end.toISOString()).toBe('2026-10-13T03:00:00.000Z')
  })
})

describe('turkeyDateString', () => {
  it('UTC gece yarısından önceki anı Türkiye tarihine göre döner', () => {
    expect(turkeyDateString(new Date('2026-10-11T22:30:00Z'))).toBe('2026-10-12')
  })
})

describe('findMissedAttendance', () => {
  it('eşik dolmadan giriş uyarısı üretmez', () => {
    expect(findMissedAttendance([shift()], [], tr('2026-10-12T09:20:00'), CONFIG)).toEqual([])
  })

  it('eşik geçtiyse ve giriş yoksa missed_clock_in üretir', () => {
    const alerts = findMissedAttendance([shift()], [], tr('2026-10-12T09:31:00'), CONFIG)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].type).toBe('attendance_missed_clock_in')
    expect(alerts[0].employeeName).toBe('Ayşe Yılmaz')
  })

  it('giriş yapılmışsa giriş uyarısı üretmez', () => {
    const records = [{ shift_assignment_id: 's1', clock_in_at: '2026-10-12T06:05:00Z', clock_out_at: null }]
    expect(findMissedAttendance([shift()], records, tr('2026-10-12T12:00:00'), CONFIG)).toEqual([])
  })

  it('vardiya bitiminden sonra çıkış yoksa missed_clock_out üretir', () => {
    const records = [{ shift_assignment_id: 's1', clock_in_at: '2026-10-12T06:05:00Z', clock_out_at: null }]
    const alerts = findMissedAttendance([shift()], records, tr('2026-10-12T17:31:00'), CONFIG)
    expect(alerts.map((a) => a.type)).toEqual(['attendance_missed_clock_out'])
  })

  it('çıkış yapılmışsa uyarı üretmez', () => {
    const records = [{ shift_assignment_id: 's1', clock_in_at: '2026-10-12T06:05:00Z', clock_out_at: '2026-10-12T14:00:00Z' }]
    expect(findMissedAttendance([shift()], records, tr('2026-10-12T18:00:00'), CONFIG)).toEqual([])
  })

  it('izinli vardiya ve pasif çalışan atlanır', () => {
    const shifts = [
      shift({ is_on_leave: true }),
      { ...shift({ id: 's2' }), employees: { full_name: 'X', active: false } },
    ]
    expect(findMissedAttendance(shifts, [], tr('2026-10-12T12:00:00'), CONFIG)).toEqual([])
  })

  it('24 saatten eski vardiyalar için uyarı üretmez', () => {
    expect(findMissedAttendance([shift({ work_date: '2026-10-11' })], [], tr('2026-10-12T10:00:00'), CONFIG)).toEqual([])
  })
})
