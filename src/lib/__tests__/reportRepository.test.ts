/// <reference types="vitest/globals" />
import { buildReportSummary, exportReportToCsv } from '../reportRepository'
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

  const clockedOut = (rec: Record<string, unknown>) => mapReportRow({
    ...shift,
    attendance_records: [{
      id: 'r1',
      status: 'clocked_out',
      clock_in_at: '2026-10-01T06:00:00Z',
      break_start_at: null,
      break_end_at: null,
      clock_out_at: '2026-10-01T14:00:00Z',
      completed_break_minutes: 0,
      ...rec,
    }],
  }, now)

  // 09:00–17:00 (8s brüt) vardiyanın planlanan molası 60 dk
  it('molaları uzatan çalışanın aşan dakikaları düşer, sonuç buçuklu saate yuvarlanır', () => {
    const row = clockedOut({
      break_start_at: '2026-10-01T11:00:00Z',
      break_end_at: '2026-10-01T11:25:00Z',
      completed_break_minutes: 50,
    })
    expect(row.record_id).toBe('r1')
    expect(row.break_minutes).toBe(75)
    // 8s − 75dk = 6s 45dk → 6s 30dk
    expect(row.worked_minutes).toBe(6 * 60 + 30)
  })

  it('mola okutmadan erken çıkandan mola düşülmez', () => {
    // 09:00 giriş, 12:00 çıkış (5 saat erken)
    const row = clockedOut({ clock_out_at: '2026-10-01T09:00:00Z' })
    expect(row.break_minutes).toBe(0)
    expect(row.worked_minutes).toBe(3 * 60)
  })

  it('molaya çıkıp erken çıkanın süresi fiilene göre hesaplanır', () => {
    // 09:00–15:12 (6s 12dk kaldı): bu süre için planlanan mola 60 dk
    const out = '2026-10-01T12:12:00Z'
    // 70 dk mola okuttu → 5s 2dk → 5s
    const longBreak = clockedOut({ break_start_at: '2026-10-01T09:00:00Z', break_end_at: '2026-10-01T10:10:00Z', clock_out_at: out })
    expect(longBreak.break_minutes).toBe(70)
    expect(longBreak.worked_minutes).toBe(5 * 60)
    // 40 dk mola okuttu → kalınan süreye göre 60 dk düşülür → 5s 12dk → 5s
    const shortBreak = clockedOut({ break_start_at: '2026-10-01T09:00:00Z', break_end_at: '2026-10-01T09:40:00Z', clock_out_at: out })
    expect(shortBreak.break_minutes).toBe(60)
    expect(shortBreak.worked_minutes).toBe(5 * 60)
  })

  it('planlanandan kısa mola yapan çalışandan planlanan mola düşülür', () => {
    const row = clockedOut({
      break_start_at: '2026-10-01T11:00:00Z',
      break_end_at: '2026-10-01T11:15:00Z',
      completed_break_minutes: 30,
    })
    expect(row.break_minutes).toBe(60)
    expect(row.worked_minutes).toBe(8 * 60 - 60)
  })

  it('mola okutmayan çalışan planlanan molayı yapmış sayılır', () => {
    const row = clockedOut({})
    expect(row.break_minutes).toBe(60)
    expect(row.worked_minutes).toBe(8 * 60 - 60)
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

  it('vardiyayı tamamlayandan planlanan mola ile fiili toplam moladan büyüğü düşülür', () => {
    // 09:00–18:00 (TR) vardiya, planlanan mola 60 dk
    const shift = { work_date: '2026-10-01', start_time: '09:00', end_time: '18:00' }
    const rec = {
      clock_in_at: '2026-10-01T06:00:00Z',
      break_start_at: '2026-10-01T12:00:00Z',
      break_end_at: '2026-10-01T12:15:00Z',
      clock_out_at: '2026-10-01T15:00:00Z',
      completed_break_minutes: 30,
    }
    expect(workedMinutes(rec, shift)).toBe(9 * 60 - 60)
    expect(workedMinutes({ ...rec, completed_break_minutes: 75 }, shift)).toBe(7 * 60 + 30) // 90 dk mola
    expect(workedMinutes({ ...rec, break_start_at: null, break_end_at: null, completed_break_minutes: 0 }, shift)).toBe(9 * 60 - 60)
  })

  it('1,5 saat molalı vardiya: 1 saat yemek + 30 dk mola (sıra fark etmez)', () => {
    // 08:00–18:00 (TR) = 10 saat brüt → planlanan mola 90 dk → net 8,5 saat
    const shift = { work_date: '2026-10-01', start_time: '08:00', end_time: '18:00' }
    const base = { clock_in_at: '2026-10-01T05:00:00Z', clock_out_at: '2026-10-01T15:00:00Z' }
    // Önce yemek (60), sonra 30'luk mola
    expect(workedMinutes({ ...base, completed_break_minutes: 60,
      break_start_at: '2026-10-01T12:00:00Z', break_end_at: '2026-10-01T12:30:00Z' }, shift)).toBe(8 * 60 + 30)
    // Önce 30'luk mola, sonra yemek (60)
    expect(workedMinutes({ ...base, completed_break_minutes: 30,
      break_start_at: '2026-10-01T10:00:00Z', break_end_at: '2026-10-01T11:00:00Z' }, shift)).toBe(8 * 60 + 30)
  })

  it('2 saat molalı vardiya: birer saatlik iki mola', () => {
    // 08:00–20:00 (TR) = 12 saat brüt → planlanan mola 120 dk → net 10 saat
    const shift = { work_date: '2026-10-01', start_time: '08:00', end_time: '20:00' }
    expect(workedMinutes({
      clock_in_at: '2026-10-01T05:00:00Z',
      clock_out_at: '2026-10-01T17:00:00Z',
      completed_break_minutes: 60,
      break_start_at: '2026-10-01T13:00:00Z',
      break_end_at: '2026-10-01T14:00:00Z',
    }, shift)).toBe(10 * 60)
  })
})

describe('exportReportToCsv', () => {
  it('formül ile başlayan hücreler kaçışlanır (CSV injection)', () => {
    const r = { ...row('clocked_out', 480), full_name: '=HYPERLINK("http://x")', exception_note: '+1+1' }
    const csv = exportReportToCsv([r])
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(csv).toContain(`'+1+1`)
    expect(csv).not.toMatch(/,=HYPERLINK/)
  })

  it('tek tek mola saatleri yerine toplam mola sütunu var', () => {
    const header = exportReportToCsv([]).replace('﻿', '').split('\n')[0]
    expect(header).toContain('Toplam Mola')
    expect(header).not.toContain('Mola Başlangıç')
  })
})

describe('mapReportRow — gelmedi toleransı', () => {
  const base = {
    employee_id: 'e1', work_date: '2026-10-01', start_time: '09:00:00', end_time: '17:00:00',
    is_on_leave: false, employees: { full_name: 'Ayşe' }, attendance_records: [],
  }
  it('vardiya başlangıcından 10 dk sonra henüz "gelmedi" değil', () => {
    const now = new Date('2026-10-01T09:10:00+03:00').getTime()
    expect(mapReportRow(base, now).status).toBe('upcoming')
  })
  it('tolerans geçince "gelmedi" (shift_waiting)', () => {
    const now = new Date('2026-10-01T09:45:00+03:00').getTime()
    expect(mapReportRow(base, now).status).toBe('shift_waiting')
  })
})
