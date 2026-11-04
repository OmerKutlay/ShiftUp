/**
 * networkError.test.ts — fetch'in ağ hatası ("Failed to fetch") istemcide.
 *
 * Gerileme: canlıda tatil atarken bağlantı koptu, kullanıcı İngilizce "Failed to fetch" gördü.
 * Okuma bir kez yeniden denenir; yazma tekrarlanmaz ve "kaydedilmemiş olabilir" uyarısı verir.
 * Hata ApiError değildir (çevrimdışı görünümü "sunucu yanıt vermedi" diye ayırt eder).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiError, apiDownload, apiFetch, NetworkError, NETWORK_ERROR_MSG, NETWORK_WRITE_ERROR_MSG } from '@/lib/api/http'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const networkFail = () => new TypeError('Failed to fetch')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('apiFetch — ağ hatası', () => {
  it('okuma isteği bir kez yeniden denenir; ikincisi başarılıysa hata görünmez', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(networkFail()).mockResolvedValueOnce(ok({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    const p = apiFetch<{ ok: boolean }>('/api/x')
    await vi.runAllTimersAsync()
    expect(await p).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('okuma iki kez düşerse Türkçe NetworkError (TypeError, ApiError değil)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkFail())
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    const p = apiFetch('/api/x').catch((e: unknown) => e)
    await vi.runAllTimersAsync()
    const err = await p
    expect(err).toBeInstanceOf(NetworkError)
    expect(err).toBeInstanceOf(TypeError)
    expect(err).not.toBeInstanceOf(ApiError)
    expect((err as Error).message).toBe(NETWORK_ERROR_MSG)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('yazma isteği tekrarlanmaz; "kaydedilmemiş olabilir" uyarısı', async () => {
    const fetchMock = vi.fn().mockRejectedValue(networkFail())
    vi.stubGlobal('fetch', fetchMock)
    const err = await apiFetch('/api/leave', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NetworkError)
    expect((err as Error).message).toBe(NETWORK_WRITE_ERROR_MSG)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('iptal (AbortError) olduğu gibi iletilir, yeniden denenmez', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError')
    const fetchMock = vi.fn().mockRejectedValue(abort)
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiFetch('/api/x')).rejects.toBe(abort)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('apiDownload da ağ hatasında bir kez yeniden dener', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(networkFail())
      .mockResolvedValueOnce(new Response('a;b', { status: 200, headers: { 'content-disposition': 'attachment; filename="x.csv"' } }))
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
    const p = apiDownload('/api/x')
    await vi.runAllTimersAsync()
    expect((await p).filename).toBe('x.csv')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
