/**
 * In-memory rate limiter — FAZ 8
 * Server-side only. Next.js API routes tek process'te çalıştığı için
 * geliştirme/demo ortamında yeterlidir.
 *
 * Production'da Redis tabanlı çözüme geçiş önerilir.
 */

interface RateLimitEntry {
  count: number
  resetAt: number  // Unix timestamp (ms)
}

const store = new Map<string, RateLimitEntry>()

// TTL geçmiş kayıtları temizle (bellek sızıntısı önlemi)
function pruneExpired(): void {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}

/**
 * Verilen key için rate limit kontrolü yapar.
 * @param key      — tanımlayıcı (örn: `qr_gen:${employeeId}`)
 * @param limit    — pencere içinde izin verilen maks. istek
 * @param windowMs — pencere süresi (ms)
 * @returns { allowed, remaining, resetAt }
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  // Periyodik temizlik (her 1000 çağrıda bir)
  if (Math.random() < 0.001) pruneExpired()

  const now = Date.now()
  const existing = store.get(key)

  if (!existing || existing.resetAt <= now) {
    // Yeni pencere başlat
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
