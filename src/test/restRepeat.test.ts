/**
 * restRepeat.test.ts — tekrarlayan tatil süresi: bitiş günü, tekrar sayısı, etiket.
 */
import { describe, it, expect } from 'vitest'
import { isValidRepeatWeeks, repeatLabel, repeatOccurrences, repeatUntil, sameRepeat } from '@/lib/restRepeat'

/** 2099-01-04 bir pazar */
const SUNDAY = '2099-01-04'

describe('repeatUntil', () => {
  it('süresizde bitiş yok', () => {
    expect(repeatUntil(SUNDAY, null)).toBeNull()
  })

  it('N hafta → tam N tekrar', () => {
    const until = repeatUntil(SUNDAY, { unit: 'week', count: 2 })!
    expect(until).toBe('2099-01-11')
    expect(repeatOccurrences(SUNDAY, until)).toBe(2)
    expect(repeatOccurrences(SUNDAY, repeatUntil(SUNDAY, { unit: 'week', count: 13 })!)).toBe(13)
  })

  it('N ay → N ay sonrasının bir gün öncesi', () => {
    expect(repeatUntil(SUNDAY, { unit: 'month', count: 1 })).toBe('2099-02-03')
    expect(repeatUntil(SUNDAY, { unit: 'month', count: 6 })).toBe('2099-07-03')
    expect(repeatUntil(SUNDAY, { unit: 'month', count: 12 })).toBe('2100-01-03')
  })

  it('ay sonu taşmaz: 31 Ocak + 1 ay → 27 Şubat', () => {
    expect(repeatUntil('2099-01-31', { unit: 'month', count: 1 })).toBe('2099-02-27')
  })
})

describe('repeatOccurrences / repeatLabel / doğrulama', () => {
  it('bitiş başlangıçtan önceyse 0, aynı gün 1', () => {
    expect(repeatOccurrences(SUNDAY, '2099-01-03')).toBe(0)
    expect(repeatOccurrences(SUNDAY, SUNDAY)).toBe(1)
    expect(repeatOccurrences(SUNDAY, '2099-02-03')).toBe(5)
  })

  it('etiketler', () => {
    expect(repeatLabel(null)).toBe('Süresiz')
    expect(repeatLabel({ unit: 'month', count: 3 })).toBe('3 ay')
    expect(repeatLabel({ unit: 'month', count: 12 })).toBe('1 yıl')
    expect(repeatLabel({ unit: 'week', count: 8 })).toBe('8 hafta')
  })

  it('hafta sayısı 2–104 arası tam sayı; eşitlik', () => {
    expect([1, 2, 104, 105, 2.5, Number.NaN].map(isValidRepeatWeeks)).toEqual([false, true, true, false, false, false])
    expect(sameRepeat(null, null)).toBe(true)
    expect(sameRepeat({ unit: 'week', count: 4 }, { unit: 'week', count: 4 })).toBe(true)
    expect(sameRepeat({ unit: 'week', count: 4 }, { unit: 'month', count: 4 })).toBe(false)
    expect(sameRepeat(null, { unit: 'month', count: 1 })).toBe(false)
  })
})
