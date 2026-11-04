/**
 * http — client tarafı API çağrıları için ortak fetch sarmalayıcısı.
 *
 * Hata durumunda sunucunun { error, code } gövdesini taşıyan ApiError fırlatır;
 * bileşenler err.message'ı doğrudan kullanıcıya gösterebilir.
 */
import { STORE_CHANGED_CODE, STORE_CHANGED_EVENT, STORE_HEADER } from '@/lib/storeHeader'

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
    /** Sunucunun döndürdüğü ek alanlar (ör. violations) */
    public details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Ağ hatası: istek sunucuya ulaşmadı ya da yanıt dönmedi (fetch "Failed to fetch" fırlattı) */
export const NETWORK_ERROR_MSG = 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.'
/** Yazma isteğinde ağ hatası — sunucu isteği almış olabilir, kullanıcı sonucu kontrol etmeli */
export const NETWORK_WRITE_ERROR_MSG =
  'Sunucuya ulaşılamadı; işlem kaydedilmemiş olabilir. Bağlantınızı kontrol edip tekrar deneyin.'

/**
 * fetch'in ağ hatası (TypeError "Failed to fetch") anlaşılır Türkçe mesajla.
 * TypeError'dan türer ve ApiError değildir: "sunucu yanıt vermedi" ayrımı yapan kod
 * (çevrimdışı görünüm, `instanceof TypeError` kontrolleri) aynen çalışır.
 */
export class NetworkError extends TypeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NetworkError'
  }
}

/** Ağ hatasında okuma isteğinin tek ek denemesinden önceki bekleme (ms) */
const NETWORK_RETRY_DELAY = 400

const isAbortError = (err: unknown) => err instanceof Error && err.name === 'AbortError'

/**
 * fetch + ağ hatası yönetimi. Okuma (GET/HEAD) bir kez daha denenir — boşta kapanmış bağlantı
 * gibi geçici kopmalar kullanıcıya yansımasın. Yazma tekrarlanmaz: sunucu ilk isteği uygulamış olabilir.
 * İptal (AbortError) olduğu gibi iletilir.
 */
async function fetchWithNetworkRetry(doFetch: () => Promise<Response>, retryable: boolean, signal?: AbortSignal | null) {
  try {
    return await doFetch()
  } catch (err) {
    if (isAbortError(err) || !(err instanceof TypeError)) throw err
    if (!retryable) throw new NetworkError(NETWORK_WRITE_ERROR_MSG, { cause: err })
    if (signal?.aborted) throw err
    await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY))
    try {
      return await doFetch()
    } catch (err2) {
      if (isAbortError(err2) || !(err2 instanceof TypeError)) throw err2
      throw new NetworkError(NETWORK_ERROR_MSG, { cause: err2 })
    }
  }
}

/** Cloudflare limit hatası (1102 vb.) için kullanıcıya gösterilen metin */
export const PLATFORM_LIMIT_MSG = 'Sunucu şu an yoğun, lütfen tekrar deneyin.'

/** Cloudflare limit hatasında (1102 vb.) okuma isteklerinin ek deneme bekleme süreleri (ms) */
const LIMIT_RETRY_DELAYS = [300, 900]

/**
 * Worker'ın kendisinden değil Cloudflare'den gelen hata sayfası mı?
 * Ücretsiz planda istek 10 ms CPU sınırını aşabilir (1102 → HTML 503); API route'larımız her
 * zaman JSON döner. Service worker bu sayfayı X-Platform-Limit başlıklı JSON 503'e çevirir.
 */
export function isPlatformLimitError(res: Response): boolean {
  if (res.status !== 503) return false
  return res.headers.get('x-platform-limit') === '1' || !res.headers.get('content-type')?.includes('application/json')
}

/** Bir API isteği 401 döndüğünde window'a yayılan olay; AuthProvider oturumu yeniden doğrular */
export const UNAUTHORIZED_EVENT = 'shiftup:unauthorized'

/** Sekmenin gösterdiği aktif mağaza — yazma isteklerine eklenir (bkz. @/lib/storeHeader) */
let requestStoreId: string | null = null

/** AuthProvider oturumdaki aktif mağazayı bildirir */
export function setRequestStoreId(storeId: string | null) {
  requestStoreId = storeId
}

export async function apiFetch<T>(
  url: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {}
): Promise<T> {
  const { body, headers, ...rest } = init
  // Yalnızca okuma istekleri tekrarlanır: yarıda kesilen bir yazma tekrar uygulanmamalı
  const method = (rest.method ?? 'GET').toUpperCase()
  const retryable = method === 'GET' || method === 'HEAD'
  const extra: Record<string, string> = {}
  if (body !== undefined) extra['Content-Type'] = 'application/json'
  // Yazma isteği sekmenin mağazasını taşır; sunucu farklı mağazadaysa uygulamaz (409)
  if (!retryable && requestStoreId) extra[STORE_HEADER] = requestStoreId

  const send = () =>
    fetch(url, {
      credentials: 'same-origin',
      ...rest,
      headers: Object.keys(extra).length > 0
        ? { ...extra, ...(headers as Record<string, string> | undefined) }
        : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  const doFetch = () => fetchWithNetworkRetry(send, retryable, rest.signal)

  let res = await doFetch()
  for (const delay of LIMIT_RETRY_DELAYS) {
    if (!retryable || !isPlatformLimitError(res)) break
    await new Promise((resolve) => setTimeout(resolve, delay))
    res = await doFetch()
  }

  if (isPlatformLimitError(res)) {
    throw new ApiError(PLATFORM_LIMIT_MSG, 'PLATFORM_LIMIT', res.status)
  }

  // Oturum istek sırasında düşmüş olabilir (süresi doldu, başka sekmede çıkış yapıldı)
  if (res.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.status === 409 && json.code === STORE_CHANGED_CODE && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(STORE_CHANGED_EVENT))
  }
  if (!res.ok) {
    throw new ApiError(
      typeof json.error === 'string' ? json.error : 'İstek başarısız oldu.',
      typeof json.code === 'string' ? json.code : undefined,
      res.status,
      json
    )
  }
  return json as T
}

/**
 * Dosya indirir (xlsx/csv): blob + sunucunun Content-Disposition dosya adı.
 * Hata durumunda (429, 5xx…) JSON gövdesini ApiError'a çevirir — tarayıcı ham JSON'a gitmez.
 */
export async function apiDownload(url: string): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetchWithNetworkRetry(() => fetch(url, { credentials: 'same-origin' }), true)
  if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    throw new ApiError(
      typeof json.error === 'string' ? json.error : 'İndirme başarısız oldu.',
      typeof json.code === 'string' ? json.code : undefined,
      res.status,
      json
    )
  }
  const cd = res.headers.get('content-disposition') ?? ''
  const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? null
  return { blob: await res.blob(), filename }
}
