/**
 * sessionAge — Supabase oturumu için mutlak ömür (girişten 30 gün sonra kesin çıkış).
 *
 * Supabase ücretsiz planda oturum süresi (time-box) ayarlanamaz; refresh token süresizdir.
 * Bu yüzden süre uygulama tarafında uygulanır:
 *   - Çerezler SESSION_MAX_AGE ile yazılır (varsayılan 400 gün yerine).
 *   - Token yenilendikçe çerezlerin süresi uzar; asıl sınır giriş anına göre hesaplanır.
 *     Giriş anı access token'ın `amr` claim'inden (oturuma özgü, yenilemede korunur)
 *     okunur; yoksa kullanıcının last_sign_in_at alanına düşülür.
 *
 * Edge uyumlu (middleware'den import edilir) — Node API'si kullanılmaz.
 */

/** Oturum ömrü (saniye): girişten 30 gün */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60

/** @supabase/ssr istemcilerine verilen çerez seçenekleri */
export const SUPABASE_COOKIE_OPTIONS = { maxAge: SESSION_MAX_AGE }

/** JWT payload'ını doğrulamadan çözer — token getUser() ile zaten doğrulanmış olmalı */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Supabase oturum kimliği (`session_id` claim'i; token yenilemede korunur) — yoksa null */
export function sessionIdOf(accessToken?: string | null): string | null {
  const sid = accessToken ? decodeJwtPayload(accessToken)?.session_id : undefined
  return typeof sid === 'string' && sid ? sid : null
}

/** Oturumun giriş anı (ms) — belirlenemezse null */
export function sessionStartedAt(accessToken?: string | null, lastSignInAt?: string | null): number | null {
  const amr = accessToken ? decodeJwtPayload(accessToken)?.amr : undefined
  if (Array.isArray(amr)) {
    // Detaylı format: [{ method, timestamp (saniye) }] — en eski kimlik doğrulama giriş anıdır
    const stamps = amr
      .map((e) => (e && typeof e === 'object' ? (e as { timestamp?: unknown }).timestamp : undefined))
      .filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
    if (stamps.length) return Math.min(...stamps) * 1000
  }
  const fallback = lastSignInAt ? Date.parse(lastSignInAt) : NaN
  return Number.isFinite(fallback) ? fallback : null
}

/** Girişten bu yana SESSION_MAX_AGE geçti mi? Giriş anı belirlenemezse oturum düşürülmez. */
export function isSessionExpired(
  accessToken?: string | null,
  lastSignInAt?: string | null,
  now = Date.now()
): boolean {
  const started = sessionStartedAt(accessToken, lastSignInAt)
  return started !== null && now - started > SESSION_MAX_AGE * 1000
}
