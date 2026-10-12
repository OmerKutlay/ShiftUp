import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AttendanceRecord } from '@/types/attendance'

// ============================================================
// Mock Supabase client — prevents any real DB calls
// ============================================================
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockNeq = vi.fn()
const mockIn = vi.fn()
const mockOrder = vi.fn()

// Build a chainable mock (unused helper — kept for reference)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function chainable(terminal: () => unknown) {
  const obj: Record<string, unknown> = {}
  const methods = ['select', 'insert', 'update', 'eq', 'neq', 'in', 'order']
  methods.forEach((m) => {
    obj[m] = vi.fn(() => ({ ...obj, single: mockSingle, maybeSingle: mockMaybeSingle }))
  })
  obj['single'] = mockSingle
  obj['maybeSingle'] = mockMaybeSingle
  return obj
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      eq: mockEq,
      neq: mockNeq,
      in: mockIn,
      order: mockOrder,
    })),
  },
}))

// Import after mock
import { createAttendanceRecord, performAttendanceAction } from '@/lib/attendanceRepository'
import { supabase } from '@/lib/supabase'

// ============================================================
// Test helpers
// ============================================================

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

// ============================================================
// Tests
// ============================================================

describe('attendanceRepository — createAttendanceRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. Vardiya bekleyen çalışan giriş yapabilir (kayıt oluşturulur)', async () => {
    const newRecord = makeRecord()

    // maybeSingle returns null (no existing active record)
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    // insert returns the new record
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: newRecord, error: null }),
    })

    const result = await createAttendanceRecord('shift-001', 'emp-001')

    expect(result.status).toBe('working')
    expect(result.clock_in_at).toBeTruthy()
  })

  it('9. Aynı vardiya için ikinci aktif attendance kaydı oluşturulamaz', async () => {
    const existingRecord = makeRecord({ id: 'existing-rec', status: 'working' })

    // maybeSingle returns an existing active record
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existingRecord, error: null }),
    })

    await expect(createAttendanceRecord('shift-001', 'emp-001')).rejects.toThrow(
      'Bu vardiya için zaten aktif bir devam kaydı mevcut.'
    )
  })
})

describe('attendanceRepository — performAttendanceAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('4b. Molaya çıkma — DB update çağrılır, on_break döner', async () => {
    const workingRecord = makeRecord({ status: 'working' })
    const onBreakRecord = makeRecord({ status: 'on_break', break_start_at: '2026-09-28T09:00:00.000Z' })

    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: onBreakRecord, error: null }),
    })

    const result = await performAttendanceAction(workingRecord, 'start_break')
    expect(result.status).toBe('on_break')
    expect(result.break_start_at).toBeTruthy()
  })

  it('6b. Moladan dönme — working_after_break döner', async () => {
    const onBreakRecord = makeRecord({ status: 'on_break', break_start_at: '2026-09-28T09:00:00.000Z' })
    const returnedRecord = makeRecord({
      status: 'working_after_break',
      break_start_at: '2026-09-28T09:00:00.000Z',
      break_end_at: '2026-09-28T09:30:00.000Z',
    })

    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: returnedRecord, error: null }),
    })

    const result = await performAttendanceAction(onBreakRecord, 'end_break')
    expect(result.status).toBe('working_after_break')
  })

  it('7b. Çıkış yapma — clocked_out döner', async () => {
    const workingRecord = makeRecord({ status: 'working' })
    const clockedOut = makeRecord({ status: 'clocked_out', clock_out_at: '2026-09-28T18:00:00.000Z' })

    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: clockedOut, error: null }),
    })

    const result = await performAttendanceAction(workingRecord, 'clock_out')
    expect(result.status).toBe('clocked_out')
    expect(result.clock_out_at).toBeTruthy()
  })

  it('3b. Giriş yapılmadan mola — iş kuralı hatası fırlatır (repository seviyesi)', async () => {
    const waitingRecord = makeRecord({ status: 'shift_waiting' })
    // No DB call expected — rule fires before reaching DB
    await expect(performAttendanceAction(waitingRecord, 'start_break')).rejects.toThrow(
      'Giriş yapılmadan mola başlatılamaz.'
    )
  })

  it('8b. Çıkış yapıldıktan sonra tekrar çıkış — iş kuralı hatası', async () => {
    const clockedOutRecord = makeRecord({ status: 'clocked_out', clock_out_at: '2026-09-28T18:00:00.000Z' })
    await expect(performAttendanceAction(clockedOutRecord, 'clock_out')).rejects.toThrow(
      AttendanceRuleError
    )
  })
})

// Import for the last test case
import { AttendanceRuleError } from '@/lib/attendanceStateMachine'
