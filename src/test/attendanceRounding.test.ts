import { describe, it, expect } from 'vitest'
import { roundAttendanceTime, resolveRecordedTime } from '@/lib/attendanceRounding'

const shift = { id: 's1', work_date: '2026-10-12', start_time: '10:00:00', end_time: '18:00:00' }

// Türkiye saati (UTC+3) → Date
const tr = (hhmm: string, date = '2026-10-12') => new Date(`${date}T${hhmm}+03:00`)
const hhmm = (d: Date) =>
  new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)

describe('roundAttendanceTime — giriş', () => {
  it.each([
    ['09:50:00', '09:50', false], // erken giriş aynen
    ['10:13:00', '10:13', false], // tolerans içinde aynen
    ['10:14:59', '10:14', false],
    ['10:15:00', '10:30', true],
    ['10:30:40', '10:30', true],
    ['10:31:00', '10:45', true],
    ['10:45:00', '10:45', true],
    ['10:46:00', '11:00', true],
    ['11:00:00', '11:00', true],
    ['11:20:00', '11:30', true],  // sonrası bir sonraki çeyreğe
  ])('%s okutma → %s işlenir', (scan, expected, adjusted) => {
    const r = roundAttendanceTime(shift, 'clock_in', tr(scan))
    expect(hhmm(r.recordedAt)).toBe(expected)
    expect(r.adjusted).toBe(adjusted)
  })
})

describe('roundAttendanceTime — çıkış', () => {
  it.each([
    ['18:20:00', '18:20', false], // geç çıkış aynen
    ['17:47:00', '17:47', false], // tolerans içinde aynen
    ['17:45:30', '17:30', true],
    ['17:30:00', '17:30', true],
    ['17:29:00', '17:15', true],
    ['17:15:00', '17:15', true],
    ['17:14:00', '17:00', true],
  ])('%s okutma → %s işlenir', (scan, expected, adjusted) => {
    const r = roundAttendanceTime(shift, 'clock_out', tr(scan))
    expect(hhmm(r.recordedAt)).toBe(expected)
    expect(r.adjusted).toBe(adjusted)
  })

  it('gece yarısını geçen vardiyada çıkış ertesi güne göre hesaplanır', () => {
    const night = { ...shift, start_time: '22:00', end_time: '06:00' }
    const r = roundAttendanceTime(night, 'clock_out', tr('05:40:00', '2026-10-13'))
    expect(hhmm(r.recordedAt)).toBe('05:30')
  })
})

describe('resolveRecordedTime', () => {
  it('mola aksiyonlarını yuvarlamaz', () => {
    const now = tr('13:07:00')
    expect(resolveRecordedTime(shift, 'start_break', now)).toEqual({ recordedAt: now.toISOString() })
  })

  it('yuvarlanan girişe açıklama ekler', () => {
    const r = resolveRecordedTime(shift, 'clock_in', tr('10:22:00'))
    expect(hhmm(new Date(r.recordedAt))).toBe('10:30')
    expect(r.exceptionNote).toBe("Giriş 10:22'de okutuldu, 10:30 olarak işlendi.")
  })

  it('erken çıkış girişin gerisine yuvarlanmaz ve önceki notu korur', () => {
    const r = resolveRecordedTime(shift, 'clock_out', tr('10:40:00'), {
      clock_in_at: tr('10:30:00').toISOString(),
      exception_note: "Giriş 10:22'de okutuldu, 10:30 olarak işlendi.",
    })
    expect(hhmm(new Date(r.recordedAt))).toBe('10:30')
    expect(r.exceptionNote).toContain('Giriş 10:22')
    expect(r.exceptionNote).toContain("Çıkış 10:40'de okutuldu")
  })
})
