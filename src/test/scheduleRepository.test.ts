import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { ShiftConflictError } from '@/types/schedule'

// ============================================================
// Supabase mock
// ============================================================
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

import {
  timesOverlap,
  getWeekDays,
  getWeekRange,
  createShiftAssignment,
  updateShiftAssignment,
  deleteShiftAssignment,
  fetchWeeklyAssignments,
  fetchAssignmentsForEmployeeOnDate,
} from '@/lib/scheduleRepository'
import { supabase } from '@/lib/supabase'

// ============================================================
// Helpers
// ============================================================
function makeAssignment(overrides: Partial<ShiftAssignmentWithDetails> = {}): ShiftAssignmentWithDetails {
  return {
    id: 'asgn-001',
    employee_id: 'emp-001',
    shift_template_id: 'tpl-001',
    work_date: '2026-09-28',
    start_time: '09:00',
    end_time: '18:00',
    is_on_leave: false,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    shift_templates: null,
    employees: null,
    ...overrides,
  }
}

function buildChain(terminal: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  ;['select', 'eq', 'gte', 'lte', 'order', 'insert', 'update', 'delete', 'single'].forEach((m) => {
    chain[m] = vi.fn(() => ({ ...chain, ...terminal }))
  })
  return { ...chain, ...terminal }
}

// ============================================================
// timesOverlap — pure unit tests
// ============================================================
describe('scheduleRepository — timesOverlap', () => {
  it('tam çakışma', () => {
    expect(timesOverlap('09:00', '18:00', '09:00', '18:00')).toBe(true)
  })

  it('kısmi çakışma (içinde)', () => {
    expect(timesOverlap('09:00', '18:00', '12:00', '15:00')).toBe(true)
  })

  it('kısmi çakışma (önceden başlar)', () => {
    expect(timesOverlap('09:00', '14:00', '12:00', '18:00')).toBe(true)
  })

  it('çakışma yok — peş peşe', () => {
    expect(timesOverlap('09:00', '14:00', '14:00', '18:00')).toBe(false)
  })

  it('çakışma yok — ayrı dilimler', () => {
    expect(timesOverlap('09:00', '13:00', '14:00', '18:00')).toBe(false)
  })

  it('HH:MM:SS formatını kabul eder', () => {
    expect(timesOverlap('09:00:00', '18:00:00', '12:00:00', '15:00:00')).toBe(true)
  })
})

// ============================================================
// getWeekDays
// ============================================================
describe('scheduleRepository — getWeekDays', () => {
  it('pazartesi ile başlar, 7 gün döner', () => {
    const days = getWeekDays(new Date('2026-09-28')) // Pazartesi
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-09-28') // Pazartesi
    expect(days[6]).toBe('2026-10-04') // Pazar
  })

  it('getWeekRange pazartesi-pazar aralığı', () => {
    const { start, end } = getWeekRange(new Date('2026-09-28'))
    expect(start.getDay()).toBe(1) // Pazartesi
    expect(end.getDay()).toBe(0)   // Pazar
  })
})

// ============================================================
// fetchWeeklyAssignments
// ============================================================
describe('scheduleRepository — fetchWeeklyAssignments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('haftalık atamalar döner', async () => {
    const asgns = [makeAssignment()]
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: asgns, error: null })
    )
    const result = await fetchWeeklyAssignments(new Date('2026-09-28'))
    expect(result).toHaveLength(1)
  })

  it('hata durumunda fırlatır', async () => {
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: null, error: { message: 'DB hatası' } })
    )
    await expect(fetchWeeklyAssignments(new Date())).rejects.toThrow('Haftalık plan yüklenemedi')
  })
})

// ============================================================
// createShiftAssignment
// ============================================================
describe('scheduleRepository — createShiftAssignment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pasif çalışana vardiya atanamaz', async () => {
    await expect(
      createShiftAssignment(
        { employee_id: 'emp-001', shift_template_id: 'tpl-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00' },
        false // inactive
      )
    ).rejects.toThrow('Pasif çalışana yeni vardiya atanamaz.')
  })

  it('çakışan vardiya ShiftConflictError fırlatır', async () => {
    // fetchAssignmentsForEmployeeOnDate → mevcut çakışan vardiya döner
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: [makeAssignment({ start_time: '08:00', end_time: '14:00' })], error: null })
    )
    await expect(
      createShiftAssignment(
        { employee_id: 'emp-001', shift_template_id: 'tpl-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00' },
        true
      )
    ).rejects.toThrow(ShiftConflictError)
  })

  it('vardiya oluşturulabiliyor', async () => {
    const created = makeAssignment({ id: 'new-asgn' })

    // fetchAssignmentsForEmployeeOnDate → boş (çakışma yok)
    ;(supabase.from as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(buildChain({ data: [], error: null }))
      // insert
      .mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: created, error: null }),
      })

    const result = await createShiftAssignment(
      { employee_id: 'emp-001', shift_template_id: 'tpl-001', work_date: '2026-09-28', start_time: '09:00', end_time: '18:00' },
      true
    )
    expect(result.id).toBe('new-asgn')
  })
})

// ============================================================
// updateShiftAssignment
// ============================================================
describe('scheduleRepository — updateShiftAssignment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('vardiya güncellenebiliyor', async () => {
    const updated = makeAssignment({ start_time: '10:00', end_time: '19:00' })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    })

    const result = await updateShiftAssignment('asgn-001', 'emp-001', '2026-09-28', {
      shift_template_id: 'tpl-002',
    })
    expect(result.id).toBe('asgn-001')
  })

  it('güncelleme sırasında çakışma kontrolü çalışır', async () => {
    // fetchAssignmentsForEmployeeOnDate → farklı bir çakışan kayıt döner
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({
        data: [makeAssignment({ id: 'other-asgn', start_time: '14:00', end_time: '22:00' })],
        error: null,
      })
    )
    await expect(
      updateShiftAssignment('asgn-001', 'emp-001', '2026-09-28', {
        start_time: '16:00',
        end_time: '23:00',
      })
    ).rejects.toThrow(ShiftConflictError)
  })
})

// ============================================================
// deleteShiftAssignment
// ============================================================
describe('scheduleRepository — deleteShiftAssignment', () => {
  beforeEach(() => vi.clearAllMocks())

  it('vardiya kaldırılabiliyor', async () => {
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    await expect(deleteShiftAssignment('asgn-001')).resolves.toBeUndefined()
  })

  it('hata durumunda fırlatır', async () => {
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: 'silinemedi' } }),
    })
    await expect(deleteShiftAssignment('asgn-001')).rejects.toThrow('Vardiya silinemedi')
  })
})

// ============================================================
// fetchAssignmentsForEmployeeOnDate
// ============================================================
describe('scheduleRepository — fetchAssignmentsForEmployeeOnDate', () => {
  beforeEach(() => vi.clearAllMocks())

  it('o güne ait atamalar döner', async () => {
    const asgns = [makeAssignment()]
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: asgns, error: null })
    )
    const result = await fetchAssignmentsForEmployeeOnDate('emp-001', '2026-09-28')
    expect(result).toHaveLength(1)
    expect(result[0].work_date).toBe('2026-09-28')
  })
})
