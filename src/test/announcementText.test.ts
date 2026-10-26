/**
 * announcementText.test.ts — duyuru metni temizleme, bağlantılaştırma ve girdi doğrulaması.
 */
import { describe, it, expect } from 'vitest'
import { linkifyParts, normalizeBody, normalizeTitle, previewText, safeHref } from '@/lib/announcementText'
import { parseAnnouncementInput } from '@/lib/announcementValidation'

describe('normalizeBody / normalizeTitle', () => {
  it('satır sonlarını korur (CRLF → LF) ve kontrol karakterlerini atar', () => {
    expect(normalizeBody('a\r\nb\rc\u0000d\u0007')).toBe('a\nb\ncd')
  })
  it('başlıktaki satır sonlarını boşluğa çevirir', () => {
    expect(normalizeTitle('  Merhaba\n  dünya \t ')).toBe('Merhaba dünya')
  })
})

describe('linkifyParts', () => {
  it('http/https adreslerini bağlantı yapar, cümle sonu noktalamasını dışarıda bırakır', () => {
    const parts = linkifyParts('Bak: https://example.com/a?b=1, sonra.')
    expect(parts).toEqual([
      { type: 'text', value: 'Bak: ' },
      { type: 'link', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', value: ', sonra.' },
    ])
  })
  it('eşleşmeyen kapanış parantezini atar, URL içindekini korur', () => {
    const a = linkifyParts('(bkz https://example.com/x)')
    expect(a[1]).toMatchObject({ type: 'link', value: 'https://example.com/x' })
    const b = linkifyParts('https://example.com/a_(b)')
    expect(b[0]).toMatchObject({ type: 'link', value: 'https://example.com/a_(b)' })
  })
  it('javascript:/data: gibi şemaları asla bağlantı yapmaz', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<b>x</b>')).toBeNull()
    expect(linkifyParts('javascript:alert(1) ve data:text/html,x').every((p) => p.type === 'text')).toBe(true)
  })
  it('HTML etiketlerini düz metin olarak bırakır (kaçışı React yapar)', () => {
    const parts = linkifyParts('<img src=x onerror=alert(1)> https://ok.com')
    expect(parts[0]).toEqual({ type: 'text', value: '<img src=x onerror=alert(1)> ' })
    expect(parts[1]).toMatchObject({ type: 'link', href: 'https://ok.com/' })
  })
  it('URL içermeyen metni tek parça döner, satır sonları korunur', () => {
    expect(linkifyParts('a\nb')).toEqual([{ type: 'text', value: 'a\nb' }])
  })
})

describe('previewText', () => {
  it('boşlukları tek satıra indirir ve keser', () => {
    expect(previewText('a\n\nb   c')).toBe('a b c')
    expect(previewText('x'.repeat(200), 10)).toHaveLength(10)
  })
})

describe('parseAnnouncementInput', () => {
  const ok = { title: ' Başlık ', body: 'Metin' }
  it('oluşturmada başlık ve metni zorunlu tutar', () => {
    expect(parseAnnouncementInput({ title: 'x' }, { create: true }).ok).toBe(false)
    expect(parseAnnouncementInput({ body: 'x' }, { create: true }).ok).toBe(false)
    const r = parseAnnouncementInput(ok, { create: true })
    expect(r).toEqual({ ok: true, value: { title: 'Başlık', body: 'Metin' } })
  })
  it('uzunluk sınırlarını uygular (120 / 4000)', () => {
    expect(parseAnnouncementInput({ ...ok, title: 'a'.repeat(121) }, { create: true }).ok).toBe(false)
    expect(parseAnnouncementInput({ ...ok, title: 'a'.repeat(120) }, { create: true }).ok).toBe(true)
    expect(parseAnnouncementInput({ ...ok, body: 'a'.repeat(4001) }, { create: true }).ok).toBe(false)
    expect(parseAnnouncementInput({ ...ok, body: 'a'.repeat(4000) }, { create: true }).ok).toBe(true)
  })
  it('bitiş geçmişte olamaz; geçersiz hedef rol reddedilir', () => {
    expect(parseAnnouncementInput({ ...ok, expires_at: '2000-01-01T00:00:00Z' }, { create: true }).ok).toBe(false)
    expect(parseAnnouncementInput({ ...ok, expires_at: 'bozuk' }, { create: true }).ok).toBe(false)
    expect(parseAnnouncementInput({ ...ok, target_roles: 'x' }, { create: true }).ok).toBe(false)
    expect(parseAnnouncementInput({ ...ok, expires_at: '2999-01-01T00:00:00Z' }, { create: true }).ok).toBe(true)
  })
  it('PATCH yalnızca gelen alanları alır; hedef rol / onay zorunluluğunu yok sayar', () => {
    const r = parseAnnouncementInput({ pinned: true, target_roles: 'managers', requires_ack: true }, { create: false })
    expect(r).toEqual({ ok: true, value: { pinned: true } })
  })
})
