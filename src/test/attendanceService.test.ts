/**
 * attendanceService — devam işlemleri (bellek içi fake Supabase ile).
 * Eski attendanceRepository create/perform testlerinin karşılığı + yarış/tekillik senaryoları.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AttendanceRecord } from '@/types/attendance'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'
import { performAttendanceAction, findCurrentShift, NoShiftError, type ShiftRow } from '@/lib/attendanceService'
import { AttendanceRuleError } from '@/lib/attendanceStateMachine'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/attendanceAlerts', async (orig) => ({
  ...(await orig<typeof import('@/lib/attendanceAlerts')>()),
  notifyIfLateAttendance: vi.fn(),
}))

const SHIFT: ShiftRow = {
  id: 'shift-001', employee_id: 'emp-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00', is_on_leave: false,
}

function makeRecord(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 'rec-001',
    employee_id: 'emp-001',
    shift_assignment_id: 'shift-001',
    status: 'working',
    clock_in_at: '2026-09-28T06:00:00.000Z',
    break_start_at: null,
    break_end_at: null,
    clock_out_at: null,
    completed_break_minutes: 0,
    verification_method: null,
    exception_note: null,
    created_at: '2026-09-28T06:00:00.000Z',
    updated_at: '2026-09-28T06:00:00.000Z',
    ...overrides,
  }
}

let db: FakeDb
const admin = () => db as unknown as SupabaseClient

function act(action: Parameters<typeof performAttendanceAction>[0]['action'], record: AttendanceRecord | null, at = '2026-09-28T09:00:00Z') {
  return performAttendanceAction({
    admin: admin(), shift: SHIFT, record, employeeId: 'emp-001', employeeName: 'Ahmet',
    action, verificationMethod: 'manual', applyRounding: false, notifyLate: false, now: new Date(at),
  })
}

beforeEach(() => {
  db = createFakeDb({ attendance_records: [] }, { unique: { attendance_records: [['shift_assignment_id']] } })
})

describe('attendanceService — giriş', () => {
  it('1. Vardiya bekleyen çalışan giriş yapabilir (kayıt oluşturulur)', async () => {
    const { record } = await act('clock_in', null)
    expect(record.status).toBe('working')
    expect(record.clock_in_at).toBeTruthy()
    expect(db.tables.attendance_records).toHaveLength(1)
  })

  it('9. Aynı vardiya için ikinci kayıt oluşturulamaz (DB tekil kısıtı)', async () => {
    db.tables.attendance_records.push(makeRecord())
    await expect(act('clock_in', null)).rejects.toThrow(AttendanceRuleError)
    expect(db.tables.attendance_records).toHaveLength(1)
  })

  it('çıkış yapıldıktan sonra tekrar giriş yapılamaz', async () => {
    const out = makeRecord({ status: 'clocked_out', clock_out_at: '2026-09-28T15:00:00.000Z' })
    db.tables.attendance_records.push(out)
    await expect(act('clock_in', out)).rejects.toThrow('Çıkış yapıldıktan sonra tekrar giriş yapılamaz.')
  })
})

describe('attendanceService — mola ve çıkış', () => {
  it('4b. Molaya çıkma — on_break', async () => {
    const rec = makeRecord()
    db.tables.attendance_records.push(rec)
    const { record } = await act('start_break', rec)
    expect(record.status).toBe('on_break')
    expect(record.break_start_at).toBeTruthy()
  })

  it('6b. Moladan dönme — working_after_break', async () => {
    const rec = makeRecord({ status: 'on_break', break_start_at: '2026-09-28T08:00:00.000Z' })
    db.tables.attendance_records.push(rec)
    const { record } = await act('end_break', rec)
    expect(record.status).toBe('working_after_break')
  })

  it('7b. Çıkış — clocked_out', async () => {
    const rec = makeRecord()
    db.tables.attendance_records.push(rec)
    const { record } = await act('clock_out', rec, '2026-09-28T15:00:00Z')
    expect(record.status).toBe('clocked_out')
  })

  it('3b. Giriş yapılmadan mola — iş kuralı hatası', async () => {
    await expect(act('start_break', null)).rejects.toThrow('Giriş yapılmadan mola başlatılamaz.')
  })

  it('8b. Çıkış yapıldıktan sonra tekrar çıkış — iş kuralı hatası', async () => {
    const rec = makeRecord({ status: 'clocked_out', clock_out_at: '2026-09-28T15:00:00.000Z' })
    await expect(act('clock_out', rec)).rejects.toThrow(AttendanceRuleError)
  })

  it('eşzamanlı çift mola isteğinden yalnızca biri uygulanır (optimistic lock)', async () => {
    const rec = makeRecord()
    db.tables.attendance_records.push(rec)
    const results = await Promise.allSettled([act('start_break', rec), act('start_break', rec)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(AttendanceRuleError)
  })

  it('izinli işaretli vardiyada işlem yapılamaz', async () => {
    await expect(
      performAttendanceAction({
        admin: admin(), shift: { ...SHIFT, is_on_leave: true }, record: null, employeeId: 'emp-001',
        employeeName: 'Ahmet', action: 'clock_in', verificationMethod: 'manual', applyRounding: false, notifyLate: false,
      })
    ).rejects.toThrow('izinli')
  })
})

describe('attendanceService — findCurrentShift', () => {
  it('vardiya yoksa NoShiftError', async () => {
    db.tables.shift_assignments = []
    await expect(findCurrentShift(admin(), 'emp-001', new Date('2026-09-28T07:00:00Z'))).rejects.toThrow(NoShiftError)
  })

  it('dünün açık gece vardiyası bugünün yeni vardiyasından önce gelir', async () => {
    db.tables.shift_assignments = [
      { id: 'night', employee_id: 'emp-001', work_date: '2026-09-27', start_time: '22:00', end_time: '06:00', is_on_leave: false },
      { id: 'today', employee_id: 'emp-001', work_date: '2026-09-28', start_time: '14:00', end_time: '22:00', is_on_leave: false },
    ]
    db.tables.attendance_records = [makeRecord({ id: 'r-night', shift_assignment_id: 'night', clock_in_at: '2026-09-27T19:00:00Z' })]
    const { shift, record } = await findCurrentShift(admin(), 'emp-001', new Date('2026-09-28T02:30:00Z'))
    expect(shift.id).toBe('night')
    expect(record?.id).toBe('r-night')
  })
})
