import { describe, it, expect } from 'vitest'
import {
  applyAction,
  getAllowedActions,
  buildFieldPatch,
  AttendanceRuleError,
} from '@/lib/attendanceStateMachine'
import type { AttendanceStatus } from '@/types/attendance'

// ============================================================
// State Machine Unit Tests
// ============================================================

describe('attendanceStateMachine — getAllowedActions', () => {
  it('shift_waiting: sadece clock_in izinlidir', () => {
    expect(getAllowedActions('shift_waiting')).toEqual(['clock_in'])
  })

  it('working: start_break ve clock_out izinlidir', () => {
    expect(getAllowedActions('working')).toEqual(['start_break', 'clock_out'])
  })

  it('on_break: sadece end_break izinlidir', () => {
    expect(getAllowedActions('on_break')).toEqual(['end_break'])
  })

  it('working_after_break: start_break ve clock_out izinlidir', () => {
    expect(getAllowedActions('working_after_break')).toEqual(['start_break', 'clock_out'])
  })

  it('clocked_out: hiçbir aksiyon izinli değildir', () => {
    expect(getAllowedActions('clocked_out')).toEqual([])
  })
})

describe('attendanceStateMachine — applyAction geçerli geçişler', () => {
  it('1. Vardiya bekleyen çalışan giriş yapabilir', () => {
    expect(applyAction('shift_waiting', 'clock_in')).toBe('working')
  })

  it('2. Giriş yapıldıktan sonra durum Çalışıyor olur', () => {
    const next = applyAction('shift_waiting', 'clock_in')
    expect(next).toBe('working')
  })

  it('4. Çalışan molaya çıkabilir', () => {
    expect(applyAction('working', 'start_break')).toBe('on_break')
  })

  it('6. Çalışan moladan dönebilir', () => {
    expect(applyAction('on_break', 'end_break')).toBe('working_after_break')
  })

  it('7. Çalışan çıkış yapabilir (working durumundan)', () => {
    expect(applyAction('working', 'clock_out')).toBe('clocked_out')
  })

  it('7b. Çalışan çıkış yapabilir (working_after_break durumundan)', () => {
    expect(applyAction('working_after_break', 'clock_out')).toBe('clocked_out')
  })
})

describe('attendanceStateMachine — iş kuralı ihlalleri', () => {
  it('3. Giriş yapılmadan mola başlatılamaz', () => {
    expect(() => applyAction('shift_waiting', 'start_break')).toThrow(AttendanceRuleError)
    expect(() => applyAction('shift_waiting', 'start_break')).toThrow(
      'Giriş yapılmadan mola başlatılamaz.'
    )
  })

  it('5. Moladayken tekrar mola başlatılamaz', () => {
    expect(() => applyAction('on_break', 'start_break')).toThrow(AttendanceRuleError)
    expect(() => applyAction('on_break', 'start_break')).toThrow(
      'Zaten molada iken tekrar mola başlatılamaz.'
    )
  })

  it('8. Çıkış yapıldıktan sonra tekrar çıkış yapılamaz', () => {
    expect(() => applyAction('clocked_out', 'clock_out')).toThrow(AttendanceRuleError)
  })

  it('Çıkış yapıldıktan sonra tekrar giriş yapılamaz', () => {
    expect(() => applyAction('clocked_out', 'clock_in')).toThrow(AttendanceRuleError)
    expect(() => applyAction('clocked_out', 'clock_in')).toThrow(
      'Çıkış yapıldıktan sonra tekrar giriş yapılamaz.'
    )
  })

  it('Giriş yapılmadan çıkış yapılamaz', () => {
    expect(() => applyAction('shift_waiting', 'clock_out')).toThrow(AttendanceRuleError)
    expect(() => applyAction('shift_waiting', 'clock_out')).toThrow(
      'Giriş yapılmadan çıkış yapılamaz.'
    )
  })

  it('Mola başlamadan mola bitirilemez', () => {
    expect(() => applyAction('working', 'end_break')).toThrow(AttendanceRuleError)
    expect(() => applyAction('working', 'end_break')).toThrow(
      'Mola başlamadan mola bitirilemez.'
    )
  })
})

describe('attendanceStateMachine — buildFieldPatch', () => {
  const NOW = '2026-09-28T07:00:00.000Z'

  it('clock_in patch: status=working, clock_in_at ayarlanır', () => {
    const patch = buildFieldPatch('shift_waiting', 'clock_in', NOW)
    expect(patch.status).toBe('working')
    expect(patch.clock_in_at).toBe(NOW)
    expect(patch.break_start_at).toBeUndefined()
  })

  it('start_break patch: status=on_break, break_start_at ayarlanır', () => {
    const patch = buildFieldPatch('working', 'start_break', NOW)
    expect(patch.status).toBe('on_break')
    expect(patch.break_start_at).toBe(NOW)
  })

  it('end_break patch: status=working_after_break, break_end_at ayarlanır', () => {
    const patch = buildFieldPatch('on_break', 'end_break', NOW)
    expect(patch.status).toBe('working_after_break')
    expect(patch.break_end_at).toBe(NOW)
  })

  it('clock_out patch: status=clocked_out, clock_out_at ayarlanır', () => {
    const patch = buildFieldPatch('working', 'clock_out', NOW)
    expect(patch.status).toBe('clocked_out')
    expect(patch.clock_out_at).toBe(NOW)
  })
})

describe('attendanceStateMachine — tam iş akışı', () => {
  it('shift_waiting → working → on_break → working_after_break → clocked_out', () => {
    let status: AttendanceStatus = 'shift_waiting'
    status = applyAction(status, 'clock_in')
    expect(status).toBe('working')
    status = applyAction(status, 'start_break')
    expect(status).toBe('on_break')
    status = applyAction(status, 'end_break')
    expect(status).toBe('working_after_break')
    status = applyAction(status, 'clock_out')
    expect(status).toBe('clocked_out')
  })
})
