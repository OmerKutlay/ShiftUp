/**
 * storeNorm.test.ts — mağaza aylık norm saati: varsayılan hesap, kullanım ve uyarı eşikleri.
 */
import { describe, it, expect } from 'vitest'
import {
  computeDefaultNorm, computeNormUsage, daysInMonth, majorityMonthOfWeek, monthLabelTr, normLevel,
  normMonthStart, normWarningFor, resolveStoreNorm, type NormEmployee,
} from '@/lib/storeNorm'
import { plannedNetHours } from '@/lib/storeNormService'

const emp = (over: Partial<NormEmployee> = {}): NormEmployee => ({ active: true, isKiosk: false, hire_date: null, ...over })
const many = (n: number, over: Partial<NormEmployee> = {}) => Array.from({ length: n }, () => emp(over))

describe('varsayılan norm', () => {
  it('ay günlerini hesaba katar ve 10 saate yukarı yuvarlar', () => {
    // 10 × 45 × 30/7 = 1928,57 → 1930
    expect(computeDefaultNorm(many(10), '2026-11-01')).toEqual({ normHours: 1930, employeeCount: 10 })
    // 10 × 45 × 31/7 = 1992,86 → 2000
    expect(computeDefaultNorm(many(10), '2026-10-01').normHours).toBe(2000)
    // Şubat 2026: 28 gün → 7 çalışan × 45 × 4 = 1260 (tam kat, yukarı atlamaz)
    expect(computeDefaultNorm(many(7), '2026-02-01').normHours).toBe(1260)
    expect(daysInMonth('2028-02-01')).toBe(29)
  })

  it('ay ortasında işe başlayan ayın içinde sayılır, sonraki aya başlayan sayılmaz', () => {
    const list = [emp(), emp({ hire_date: '2026-11-15' }), emp({ hire_date: '2026-12-01' })]
    expect(computeDefaultNorm(list, '2026-11-01').employeeCount).toBe(2)
  })

  it('kiosk ve pasif hesaplar sayılmaz', () => {
    const list = [emp(), emp({ isKiosk: true }), emp({ active: false })]
    expect(computeDefaultNorm(list, '2026-11-01').employeeCount).toBe(1)
  })

  it('çalışan yoksa norm 0', () => {
    expect(computeDefaultNorm([], '2026-11-01').normHours).toBe(0)
  })

  it('girilmiş norm varsayılanı ezer; kaynak işaretlenir', () => {
    const list = many(10)
    const set = resolveStoreNorm('2026-11-01', list, { norm_hours: '1240.0', note: 'Not' })
    expect(set).toMatchObject({ normHours: 1240, source: 'set', defaultHours: 1930, note: 'Not' })
    expect(resolveStoreNorm('2026-11-01', list, null)).toMatchObject({ normHours: 1930, source: 'default' })
  })
})

describe('kullanım ve eşikler', () => {
  it('yüzde, kalan ve seviye', () => {
    expect(computeNormUsage(1084, 1240)).toMatchObject({ percent: 87, remainingHours: 156, level: 'ok' })
    expect(normLevel(1116, 1240)).toBe('warn') // tam %90
    expect(normLevel(1240, 1240)).toBe('warn') // eşit: aşım değil
    expect(normLevel(1240.5, 1240)).toBe('over')
    expect(computeNormUsage(1300, 1240)).toMatchObject({ remainingHours: -60, level: 'over' })
  })

  it('uyarı yalnızca saat artınca ve eşik üstündeyse', () => {
    expect(normWarningFor(1000, 1050, 1240)).toBeNull()
    expect(normWarningFor(1100, 1120, 1240)).toBe('warn')
    expect(normWarningFor(1230, 1250, 1240)).toBe('over')
    expect(normWarningFor(1250, 1200, 1240)).toBeNull() // kısaltma/silme uyarmaz
  })
})

describe('plan toplamı', () => {
  it('molayı düşer ve izin günlerini hariç tutar', () => {
    // 09:00–18:00 = 9 sa brüt, 60 dk mola → 8 sa net
    const shifts = [
      { work_date: '2026-11-02', start_time: '09:00', end_time: '18:00' },
      { work_date: '2026-11-03', start_time: '09:00:00', end_time: '18:00:00' },
      { work_date: '2026-11-04', start_time: '09:00', end_time: '18:00', is_on_leave: true },
    ]
    expect(plannedNetHours(shifts)).toBe(16)
  })
})

describe('ay yardımcıları', () => {
  it('ay doğrulama ve etiket', () => {
    expect(normMonthStart('2026-11')).toBe('2026-11-01')
    expect(normMonthStart('2026-13')).toBeNull()
    expect(normMonthStart('x')).toBeNull()
    expect(monthLabelTr('2026-11-01')).toBe('Kasım 2026')
  })

  it('iki aya yayılan hafta çoğunluk ayını gösterir', () => {
    expect(majorityMonthOfWeek('2026-10-26')).toBe('2026-10-01') // 26 Eki–1 Kas: 6 gün Ekim
    expect(majorityMonthOfWeek('2026-11-30')).toBe('2026-12-01') // 30 Kas–6 Ara: 6 gün Aralık
    expect(majorityMonthOfWeek('2026-11-23')).toBe('2026-11-01')
  })
})
