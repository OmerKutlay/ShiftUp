import { describe, it, expect } from 'vitest'
import { formatShortDateTr, formatDateRangeTr, humanizeIsoDates } from '@/lib/dateUtils'

describe('Türkçe kısa tarih biçimleri', () => {
  it('ISO takvim gününü "22 Eki 2026" biçimine çevirir', () => {
    expect(formatShortDateTr('2026-10-22')).toBe('22 Eki 2026')
    expect(formatShortDateTr('2027-02-01')).toBe('1 Şub 2027')
    expect(formatShortDateTr('geçersiz')).toBe('geçersiz')
  })

  it('aralıkta aynı yılı bir kez, aynı günü tek tarih olarak yazar', () => {
    expect(formatDateRangeTr('2026-10-18', '2026-10-20')).toBe('18 Eki – 20 Eki 2026')
    expect(formatDateRangeTr('2026-12-30', '2027-01-02')).toBe('30 Ara 2026 – 2 Oca 2027')
    expect(formatDateRangeTr('2026-10-21', '2026-10-21')).toBe('21 Eki 2026')
  })

  it('bildirim metnindeki ham tarihleri okunur yapar, diğer metne dokunmaz', () => {
    expect(humanizeIsoDates('Mert Can — izin talebi: 2026-10-22 – 2026-10-23 tarihleri için onay bekliyor.'))
      .toBe('Mert Can — izin talebi: 22 Eki 2026 – 23 Eki 2026 tarihleri için onay bekliyor.')
    expect(humanizeIsoDates('16 Ekim 10:00-18:00 vardiyası')).toBe('16 Ekim 10:00-18:00 vardiyası')
  })
})
