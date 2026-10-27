// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { listBreaks, type AttendanceTimes } from '@/lib/attendanceDurations'

const T = (hm: string) => `2026-10-27T${hm}:00.000Z`
const base: AttendanceTimes = { clock_in_at: T('06:00'), break_start_at: null, break_end_at: null, clock_out_at: null }

describe('listBreaks — çalışanın mola satırları', () => {
  it('mola yoksa boş', () => {
    expect(listBreaks(base)).toEqual([])
  })

  it('süren tek mola: bitiş ve süre yok', () => {
    expect(listBreaks({ ...base, break_start_at: T('09:00') })).toEqual([
      { start_at: T('09:00'), end_at: null, minutes: null },
    ])
  })

  it('iki mola ayrı ayrı, sırayla', () => {
    const rec: AttendanceTimes = {
      ...base,
      previous_breaks: [{ start_at: T('09:00'), end_at: T('10:00') }],
      completed_break_minutes: 60,
      break_start_at: T('12:00'),
      break_end_at: T('12:30'),
    }
    expect(listBreaks(rec)).toEqual([
      { start_at: T('09:00'), end_at: T('10:00'), minutes: 60 },
      { start_at: T('12:00'), end_at: T('12:30'), minutes: 30 },
    ])
  })

  it('saatleri bilinmeyen önceki molalar (eski kayıt) toplam olarak tek satır', () => {
    const rec: AttendanceTimes = { ...base, completed_break_minutes: 45, break_start_at: T('12:00') }
    expect(listBreaks(rec)).toEqual([
      { start_at: null, end_at: null, minutes: 45 },
      { start_at: T('12:00'), end_at: null, minutes: null },
    ])
  })

  it('yönetici toplamı düzelttiyse saatler yerine düzeltilmiş toplam gösterilir', () => {
    const rec: AttendanceTimes = {
      ...base,
      previous_breaks: [{ start_at: T('09:00'), end_at: T('10:00') }],
      completed_break_minutes: 50,
    }
    expect(listBreaks(rec)).toEqual([{ start_at: null, end_at: null, minutes: 50 }])
  })
})
