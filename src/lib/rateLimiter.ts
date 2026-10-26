/**
 * Rate limiter — server-side only.
 *
 * Birincil depo: Postgres (rate_limit_hit RPC) — tüm sunucu instance'ları ve
 * serverless cold start'lar arasında paylaşılır, sayaç artışı atomiktir.
 * RPC yoksa / hata verirse (ör. migration uygulanmamış yerel ortam) bellek içi
 * sayaca düşer; bu yalnızca tek process için geçerlidir.
 */
import { createAdminClient } from '@/lib/supabaseAdmin'

interface RateLimitEntry {
  count: number
  resetAt: number  // Unix timestamp (ms)
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// TTL geçmiş kayıtları temizle (bellek sızıntısı önlemi)
function pruneExpired(): void {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}

/** Bellek içi sabit pencere sayacı (fallback ve testler için) */
export function checkRateLimitLocal(key: string, limit: number, windowMs: number): RateLimitResult {
  // Periyodik temizlik (her 1000 çağrıda bir)
  if (Math.random() < 0.001) pruneExpired()

  const now = Date.now()
  const existing = store.get(key)

  if (!existing || existing.resetAt <= now) {
    const entry: RateLimitEntry = { count: 1, resetAt: now + windowMs }
    store.set(key, entry)
    return { allowed: true, remaining: limit - 1, resetAt: entry.resetAt }
  }

  existing.count++

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt }
  }

  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt }
}

/**
 * Verilen key için rate limit kontrolü yapar ve sayacı artırır.
 * @param key      — tanımlayıcı (örn: `otp_send:email:${email}`)
 * @param limit    — pencere içinde izin verilen maks. istek
 * @param windowMs — pencere süresi (ms)
 */
export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('rate_limit_hit', {
      p_key: key,
      p_limit: limit,
      p_window_ms: windowMs,
    })
    if (error || !data) throw error ?? new Error('rate_limit_hit boş yanıt')
    const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; remaining: number; reset_at: string }
    return { allowed: row.allowed, remaining: row.remaining, resetAt: new Date(row.reset_at).getTime() }
  } catch {
    return checkRateLimitLocal(key, limit, windowMs)
  }
}

/**
 * İstemci IP'si. Cloudflare'de cf-connecting-ip esas alınır: Cloudflare onu her istekte kendisi
 * yazar. x-forwarded-for'un ilk değeri istemcinin gönderdiği başlıktan gelir (Cloudflare kendi
 * değerini sona ekler) — ona güvenilseydi her istekte farklı IP yazılarak IP limiti atlatılırdı.
 * x-forwarded-for yalnızca Cloudflare dışı (yerel geliştirme) ortam içindir.
 */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
