/**
 * http — client tarafı API çağrıları için ortak fetch sarmalayıcısı.
 *
 * Hata durumunda sunucunun { error, code } gövdesini taşıyan ApiError fırlatır;
 * bileşenler err.message'ı doğrudan kullanıcıya gösterebilir.
 */

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

export async function apiFetch<T>(
  url: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {}
): Promise<T> {
  const { body, headers, ...rest } = init
  const doFetch = () =>
    fetch(url, {
      credentials: 'same-origin',
      ...rest,
      headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

  // Yalnızca okuma istekleri tekrarlanır: yarıda kesilen bir yazma tekrar uygulanmamalı
  const method = (rest.method ?? 'GET').toUpperCase()
  const retryable = method === 'GET' || method === 'HEAD'

  let res = await doFetch()
  for (const delay of LIMIT_RETRY_DELAYS) {
    if (!retryable || !isPlatformLimitError(res)) break
    await new Promise((resolve) => setTimeout(resolve, delay))
    res = await doFetch()
  }

  if (isPlatformLimitError(res)) {
    throw new ApiError('Sunucu şu an yoğun, lütfen tekrar deneyin.', 'PLATFORM_LIMIT', res.status)
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
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
