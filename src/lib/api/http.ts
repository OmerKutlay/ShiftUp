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

export async function apiFetch<T>(
  url: string,
  init: Omit<RequestInit, 'body'> & { body?: unknown } = {}
): Promise<T> {
  const { body, headers, ...rest } = init
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...rest,
    headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

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
