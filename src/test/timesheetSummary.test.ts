// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { TimesheetRow } from '@/lib/timesheet'
import {
  codeCounts, hoursLabel, monthLabel, planLabel, shiftMonth, summarizeTimesheet,
} from '@/components/reports/timesheetSummary'

function row(over: Partial<TimesheetRow> & { name: string }): TimesheetRow {
  const { name, ...rest } = over
  return {
    employee: { id: name, full_name: name, role_name: 'Kasiyer', employment_type: 'full_time' },
    days: {}, dayMins: {}, dayPlan: {},
    workedMins: 0, nightMins: 0, overtimeMins: 0, holidayWorkedDays: 0, workedDays: 0, absentDays: 0,
    leaveDays: { 'Yİ': 0, 'Rİ': 0, 'Üİ': 0, 'Mİ': 0, 'HT': 0 },
    sgkDays: 30, overtimeWithoutConsent: false,
    ...rest,
  }
}

describe('timesheetSummary — biçimlendirme', () => {
  it('saatler Türkçe ondalık ve binlik ayraçla', () => {
    expect(hoursLabel(5430)).toBe('90,5')
    expect(hoursLabel(87_990)).toBe('1.466,5')
    expect(hoursLabel(0)).toBe('0')
  })
  it('ay etiketi ve ay kaydırma (yıl geçişi dahil)', () => {
    expect(monthLabel('2026-10')).toBe('Ekim 2026')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
  it('plan etiketi tam saatlerde kısalır', () => {
    expect(planLabel({ start: '14:00', end: '22:00' })).toBe('14–22')
    expect(planLabel({ start: '09:30', end: '18:00' })).toBe('09:30–18')
  })
})

describe('summarizeTimesheet', () => {
  const rows = [
    row({ name: 'Mehmet Müdür', workedMins: 600, overtimeMins: 120, absentDays: 1 }),
    row({ name: 'Emre Çelik', workedMins: 300, overtimeMins: 60, overtimeWithoutConsent: true }),
    row({ name: 'Elif Yıldız', workedMins: 60, leaveDays: { 'Yİ': 3, 'Rİ': 1, 'Üİ': 0, 'Mİ': 0, 'HT': 4 } }),
  ]

  it('KPI toplamları; hafta tatili izin sayılmaz', () => {
    const k = summarizeTimesheet(rows, '2026-10', '2026-10-19')
    expect(k).toMatchObject({
      people: 3, netMins: 960, daysLeft: 12,
      overtimeMins: 180, overtimePeople: 2, missingConsent: ['Emre Çelik'],
      absentDays: 1, absentNames: ['Mehmet'],
      leaveDays: 4, annualLeaveDays: 3, sickDays: 1,
    })
  })
  it('geçmiş ayda "ay sonuna kalan gün" yok', () => {
    expect(summarizeTimesheet(rows, '2026-09', '2026-10-19').daysLeft).toBeNull()
  })
})

describe('codeCounts', () => {
  it('yalnızca görülen kodlar, lejant sırasıyla', () => {
    const r = row({ name: 'A', days: { '2026-10-01': 'P', '2026-10-02': 'Ç', '2026-10-03': 'HT', '2026-10-04': 'Ç', '2026-10-05': '' } })
    expect(codeCounts(r)).toEqual([{ code: 'Ç', count: 2 }, { code: 'HT', count: 1 }, { code: 'P', count: 1 }])
  })
})
