import { describe, it, expect } from 'vitest'
import { computeAnnualLeaveBalance, countLeaveDays } from '@/lib/annualLeave'

const none = new Set<string>()

describe('annualLeave — gün sayımı (Md. 56)', () => {
  it('Pazar ve resmi tatil izinden sayılmaz', () => {
    // 2026-10-26 Pzt … 2026-11-01 Paz; 29 Ekim resmi tatil
    expect(countLeaveDays('2026-10-26', '2026-11-01', new Set(['2026-10-29']))).toBe(5)
  })
})

describe('annualLeave — bakiye (Md. 53)', () => {
  it('işe giriş tarihi yoksa hesaplanamaz', () => {
    const b = computeAnnualLeaveBalance({ hireDate: null, birthDate: null, today: '2026-10-12', requests: [], fullDayHolidays: none })
    expect(b.known).toBe(false)
  })

  it('1 yılı doldurmamış çalışanın hakkı yok', () => {
    const b = computeAnnualLeaveBalance({ hireDate: '2026-01-10', birthDate: null, today: '2026-10-12', requests: [], fullDayHolidays: none })
    expect(b.entitlementDays).toBe(0)
  })

  it('3 yıllık çalışan 14 gün; dönem içi onaylı ve bekleyen talepler düşülür', () => {
    const b = computeAnnualLeaveBalance({
      hireDate: '2023-03-15', birthDate: '1995-01-01', today: '2026-10-12', fullDayHolidays: none,
      requests: [
        { start_date: '2026-04-06', end_date: '2026-04-10', status: 'approved' },  // 5 iş günü
        { start_date: '2026-11-02', end_date: '2026-11-03', status: 'pending' },   // 2 gün
        { start_date: '2025-06-02', end_date: '2025-06-06', status: 'approved' },  // önceki dönem
        { start_date: '2026-05-04', end_date: '2026-05-05', status: 'rejected' },
      ],
    })
    expect(b.periodStart).toBe('2026-03-15')
    expect(b.periodEnd).toBe('2027-03-14')
    expect(b.entitlementDays).toBe(14)
    expect(b.usedDays).toBe(5)
    expect(b.pendingDays).toBe(2)
    expect(b.remainingDays).toBe(7)
  })

  it('50 yaş üstü en az 20 gün', () => {
    const b = computeAnnualLeaveBalance({ hireDate: '2023-03-15', birthDate: '1970-05-01', today: '2026-10-12', requests: [], fullDayHolidays: none })
    expect(b.entitlementDays).toBe(20)
  })
})
