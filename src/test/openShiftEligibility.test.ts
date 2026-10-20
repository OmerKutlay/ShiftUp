import { describe, it, expect } from 'vitest'
import { matchesRoleNeeded } from '@/lib/openShiftEligibility'

describe('matchesRoleNeeded', () => {
  it('gerekli rol yoksa herkes üstlenebilir', () => {
    expect(matchesRoleNeeded(null, 'Kasiyer')).toBe(true)
    expect(matchesRoleNeeded('  ', null)).toBe(true)
  })
  it('rol adı büyük/küçük harf ve boşluk duyarsız, Türkçe kurallarıyla eşleşir', () => {
    expect(matchesRoleNeeded('Satış Danışmanı', 'satış danışmanı ')).toBe(true)
    expect(matchesRoleNeeded('İNSAN KAYNAKLARI', 'insan kaynakları')).toBe(true)
  })
  it('farklı rol veya rolü olmayan çalışan üstlenemez', () => {
    expect(matchesRoleNeeded('Kasiyer', 'Depo Çalışanı')).toBe(false)
    expect(matchesRoleNeeded('Kasiyer', null)).toBe(false)
  })
})
