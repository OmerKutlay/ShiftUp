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

/** Cloudflare limit hatasında (1102 vb.) okuma isteklerinin ek deneme bekleme süreleri (ms) */
const LIMIT_RETRY_DELAYS = [300, 900]

/**
 * Worker'ın kendisinden değil Cloudflare'den gelen hata sayfası mı?
 * Ücretsiz planda soğuk başlangıç 10 ms CPU sınırını aşabilir (1102 → HTML 503);
 * API route'larımız her zaman JSON döner.
 */
function isPlatformLimitError(res: Response): boolean {
  return res.status === 503 && !res.headers.get('content-type')?.includes('application/json')
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

  const doFetch = () =>
    fetch(url, {
      credentials: 'same-origin',
      ...rest,
      headers: Object.keys(extra).length > 0
        ? { ...extra, ...(headers as Record<string, string> | undefined) }
        : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  let res = await doFetch()
  for (const delay of LIMIT_RETRY_DELAYS) {
    if (!retryable || !isPlatformLimitError(res)) break
    await new Promise((resolve) => setTimeout(resolve, delay))
    res = await doFetch()
  }

  if (isPlatformLimitError(res)) {
    throw new ApiError('Sunucu şu an yoğun, lütfen tekrar deneyin.', 'PLATFORM_LIMIT', res.status)
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
  const res = await fetch(url, { credentials: 'same-origin' })
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
