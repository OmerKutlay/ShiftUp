/**
 * platformLimit.test.ts — Cloudflare 1102 (CPU sınırı) yanıtlarının istemcide tanınması.
 *
 * Gerileme: 1102 HTML sayfası res.json() ile okunduğunda kullanıcı "Unexpected token" görüyordu;
 * service worker artık bu sayfayı X-Platform-Limit başlıklı JSON 503'e çevirir.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiFetch, isPlatformLimitError, PLATFORM_LIMIT_MSG } from '@/lib/api/http'

const html503 = () => new Response('<html>Error 1102</html>', { status: 503, headers: { 'content-type': 'text/html' } })
const swJson503 = () =>
  new Response(JSON.stringify({ error: PLATFORM_LIMIT_MSG, code: 'PLATFORM_LIMIT' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'x-platform-limit': '1' },
  })

afterEach(() => vi.unstubAllGlobals())

describe('isPlatformLimitError', () => {
  it('Cloudflare HTML 503 ve service worker JSON 503 tanınır; uygulamanın JSON 503 / 500 yanıtı tanınmaz', () => {
    expect(isPlatformLimitError(html503())).toBe(true)
    expect(isPlatformLimitError(swJson503())).toBe(true)
    expect(isPlatformLimitError(new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }))).toBe(false)
    expect(isPlatformLimitError(new Response('x', { status: 500, headers: { 'content-type': 'text/html' } }))).toBe(false)
  })
})

describe('apiFetch — limit hatası', () => {
  it('okuma isteği service worker JSON 503\'ünde yeniden denenir', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(swJson503())
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    const p = apiFetch<{ ok: boolean }>('/api/x')
    await vi.runAllTimersAsync()
    expect(await p).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('yazma isteği tekrarlanmaz, anlaşılır mesajla hata verir', async () => {
    const fetchMock = vi.fn().mockResolvedValue(html503())
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/api/x', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'PLATFORM_LIMIT',
      message: PLATFORM_LIMIT_MSG,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
