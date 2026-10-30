// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { breakStats, breakStatsLabel } from '@/components/daily-attendance/BreakDetails'
import { timelineSegments, shiftWindow } from '@/components/daily-attendance/attendanceTime'
import type { BreakItem } from '@/lib/attendanceDurations'

const T = (hm: string) => `2026-10-30T${hm}:00+03:00`
const ms = (hm: string) => new Date(T(hm)).getTime()

describe('breakStats — mola özeti', () => {
  it('tamamlanan iki mola: sayı ve toplam', () => {
    const breaks: BreakItem[] = [
      { start_at: T('11:00'), end_at: T('11:15'), minutes: 15 },
      { start_at: T('14:00'), end_at: T('14:12'), minutes: 12 },
    ]
    const stats = breakStats(breaks, ms('16:00'))
    expect(stats).toEqual({ count: 2, total: 27, active: null })
    expect(breakStatsLabel(stats)).toBe('Molalar: 2 mola, toplam 27 dk')
  })

  it('süren ikinci mola: sırası ve şimdiye kadarki süresi toplama girer', () => {
    const breaks: BreakItem[] = [
      { start_at: T('11:00'), end_at: T('11:15'), minutes: 15 },
      { start_at: T('14:00'), end_at: null, minutes: null },
    ]
    const stats = breakStats(breaks, ms('14:10'))
    expect(stats).toEqual({ count: 2, total: 25, active: { ordinal: 2, minutes: 10 } })
    expect(breakStatsLabel(stats)).toBe('Molalar: 2 mola, toplam 25 dk, 2. mola sürüyor')
  })

  it('saatsiz önceki molalar varsa sayı ve sıra bilinmez', () => {
    const breaks: BreakItem[] = [
      { start_at: null, end_at: null, minutes: 45 },
      { start_at: T('14:00'), end_at: null, minutes: null },
    ]
    expect(breakStats(breaks, ms('14:05'))).toEqual({ count: null, total: 50, active: { ordinal: null, minutes: 5 } })
  })
})

describe('timelineSegments — tüm molalar çizelgede', () => {
  const win = shiftWindow('2026-10-30', '09:00', '18:00')

  it('önceki ve son mola ayrı parçalar, aralar çalışma', () => {
    const rec = {
      status: 'working_after_break' as const,
      clock_in_at: T('09:00'),
      clock_out_at: null,
      break_start_at: T('14:00'),
      break_end_at: T('14:10'),
      previous_breaks: [{ start_at: T('11:00'), end_at: T('11:15') }],
    }
    const segs = timelineSegments(win, rec, 'working', ms('15:00')).slice(1)
    expect(segs).toEqual([
      { kind: 'worked', from: ms('09:00'), to: ms('11:00') },
      { kind: 'break', from: ms('11:00'), to: ms('11:15') },
      { kind: 'worked', from: ms('11:15'), to: ms('14:00') },
      { kind: 'break', from: ms('14:00'), to: ms('14:10') },
      { kind: 'worked', from: ms('14:10'), to: ms('15:00') },
    ])
  })

  it('süren mola şimdiye kadar uzar', () => {
    const rec = {
      status: 'on_break' as const,
      clock_in_at: T('09:00'),
      clock_out_at: null,
      break_start_at: T('12:00'),
      break_end_at: null,
    }
    expect(timelineSegments(win, rec, 'on_break', ms('12:20')).slice(1)).toEqual([
      { kind: 'worked', from: ms('09:00'), to: ms('12:00') },
      { kind: 'break', from: ms('12:00'), to: ms('12:20') },
    ])
  })
})
