import { describe, it, expect } from 'vitest'
import {
  statutoryMinBreakMins,
  nightMinutes,
  nightWorkViolation,
  weeklyOvertimeMins,
  annualLeaveEntitlementDays,
  completedYears,
  grossMins,
} from '@/lib/laborLaw'
import { netWorkMins, plannedBreakMins, checkNightWork } from '@/lib/workingTimeService'

describe('laborLaw — Md. 68 ara dinlenme', () => {
  it('4 saate kadar 15 dk', () => expect(statutoryMinBreakMins(240)).toBe(15))
  it('4–7,5 saat 30 dk', () => expect(statutoryMinBreakMins(300)).toBe(30))
  it('7,5 saat sınırı 30 dk', () => expect(statutoryMinBreakMins(450)).toBe(30))
  it('7,5 saati aşan 60 dk', () => expect(statutoryMinBreakMins(451)).toBe(60))
})

describe('workingTimeService — planlanan mola yasal asgarinin altına düşmez', () => {
  it('4 saatlik part-time vardiya 3s45dk net sayılır (eskiden 3s)', () => {
    expect(netWorkMins('10:00', '14:00')).toBe(225)
  })
  it('8 saatlik vardiyada 60 dk mola', () => expect(plannedBreakMins('09:00', '17:00')).toBe(60))
  it('12 saatlik vardiyada mağaza politikası 120 dk', () => expect(plannedBreakMins('10:00', '22:00')).toBe(120))
  it('her vardiya uzunluğunda mola ≥ yasal asgari', () => {
    for (let h = 1; h <= 14; h++) {
      const end = `${String(8 + h).padStart(2, '0')}:00`
      const start = '08:00'
      if (8 + h >= 24) continue
      expect(plannedBreakMins(start, end)).toBeGreaterThanOrEqual(statutoryMinBreakMins(grossMins(start, end)))
    }
  })
})

describe('laborLaw — Md. 69 gece çalışması', () => {
  it('14:00–23:00 → 3 saat gece', () => expect(nightMinutes('14:00', '23:00')).toBe(180))
  it('22:00–06:00 → 8 saat gece', () => expect(nightMinutes('22:00', '06:00')).toBe(480))
  it('04:00–12:00 → 2 saat gece (sabah dilimi)', () => expect(nightMinutes('04:00', '12:00')).toBe(120))
  it('kapanış vardiyası (14–23) ihlal değil', () => {
    expect(nightWorkViolation('14:00', '23:00', netWorkMins('14:00', '23:00'))).toBe(false)
  })
  it('22:00–07:00 gece vardiyası (8s net) ihlal', () => {
    expect(checkNightWork('22:00', '07:00')?.type).toBe('night_work')
  })
  it('22:00–06:00 (8s brüt, 7s net) ihlal değil', () => {
    expect(checkNightWork('22:00', '06:00')).toBeNull()
  })
})

describe('laborLaw — Md. 41 fazla çalışma', () => {
  it('45 saate kadar fazla çalışma yok', () => expect(weeklyOvertimeMins(45 * 60)).toBe(0))
  it('47 saat → 120 dk fazla çalışma', () => expect(weeklyOvertimeMins(47 * 60)).toBe(120))
})

describe('laborLaw — Md. 53 yıllık izin', () => {
  it('1 yıldan az → 0', () => expect(annualLeaveEntitlementDays(0)).toBe(0))
  it('1–5 yıl → 14', () => expect(annualLeaveEntitlementDays(3)).toBe(14))
  it('5 yıl (dahil) → 14, 6 yıl → 20', () => {
    expect(annualLeaveEntitlementDays(5)).toBe(14)
    expect(annualLeaveEntitlementDays(6)).toBe(20)
  })
  it('15+ yıl → 26', () => expect(annualLeaveEntitlementDays(15)).toBe(26))
  it('18 yaş altı / 50 yaş üstü en az 20', () => {
    expect(annualLeaveEntitlementDays(2, 17)).toBe(20)
    expect(annualLeaveEntitlementDays(2, 52)).toBe(20)
  })
  it('completedYears yıl dönümünü doğru sayar', () => {
    expect(completedYears('2020-10-12', '2026-10-11')).toBe(5)
    expect(completedYears('2020-10-12', '2026-10-12')).toBe(6)
  })
})

describe('laborLaw — 18 yaş altı korumaları', async () => {
  const { minorWorkViolations } = await import('@/lib/laborLaw')
  it('yetişkin için kısıt yok', () => expect(minorWorkViolations(25, '14:00', '23:00', 480)).toEqual([]))
  it('yaş bilinmiyorsa kısıt uygulanmaz', () => expect(minorWorkViolations(null, '22:00', '06:00', 420)).toEqual([]))
  it('17 yaş: gece çalışması yasak', () => {
    expect(minorWorkViolations(17, '14:00', '21:00', 360)[0]).toContain('gece')
  })
  it('17 yaş: günde 8 saati aşamaz', () => {
    expect(minorWorkViolations(17, '08:00', '18:00', 540)).toEqual(['18 yaşından küçük çalışan günde en fazla 8 saat çalışabilir.'])
  })
  it('17 yaş: gündüz 8 saat uygun', () => expect(minorWorkViolations(17, '09:00', '18:00', 480)).toEqual([]))
})
