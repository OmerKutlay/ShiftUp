import { describe, it, expect } from 'vitest'
import { displayStatus } from '@/components/my-schedule/MySchedulePage'

const NOW = new Date(2026, 9, 30, 15, 0) // 30 Eki 2026 15:00 (yerel)

function entry(workDate: string, status: string, start = '09:00:00', end = '17:00:00') {
  return {
    work_date: workDate, start_time: start, end_time: end, shift_name: null, status,
    clock_in_at: null, clock_out_at: null, break_start_at: null, break_end_at: null,
    worked_minutes: null, break_minutes: null, is_on_leave: false,
  }
}

describe('MySchedulePage displayStatus', () => {
  it('geçmiş günde çıkışsız kayıt "no_clock_out" olur', () => {
    expect(displayStatus(entry('2026-10-29', 'working'), NOW)).toBe('no_clock_out')
    expect(displayStatus(entry('2026-10-29', 'on_break'), NOW)).toBe('no_clock_out')
  })
  it('bugünün açık kaydı aktif kalır', () => {
    expect(displayStatus(entry('2026-10-30', 'working'), NOW)).toBe('working')
  })
  it('tamamlanan geçmiş gün değişmez', () => {
    expect(displayStatus(entry('2026-10-29', 'clocked_out'), NOW)).toBe('clocked_out')
  })
  it('dün başlayan gece vardiyası bitiş saatine kadar aktif kalır', () => {
    const morning = new Date(2026, 9, 30, 4, 0)
    expect(displayStatus(entry('2026-10-29', 'working', '22:00:00', '06:00:00'), morning)).toBe('working')
    expect(displayStatus(entry('2026-10-29', 'working', '22:00:00', '06:00:00'), NOW)).toBe('no_clock_out')
  })
})
