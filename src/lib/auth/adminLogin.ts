/**
 * adminLogin — Admin girişinin ikinci faktörü (admin şifresi) için imzalı çerezler.
 *
 * Admin oturumu yalnızca /login/admin akışıyla açılır: admin şifresi → e-posta kodu.
 * Supabase oturumu tek başına yetmez — e-posta kutusuna erişen biri Supabase'den doğrudan kod
 * isteyip oturum açabilir. Bu yüzden akışın sonunda oturuma bağlı ADMIN_VERIFIED_COOKIE yazılır;
 * middleware, getCurrentEmployee ve /api/auth/me admin hesabını bu çerez yoksa oturumsuz sayar
 * (sonradan admin yapılan bir çalışanın açık oturumu da böylece admin girişine düşer).
 *
 * İki çerez:
 *   admin_verified       — { sub: çalışan id, sid: oturum kimliği }; oturum boyunca geçerli.
 *                          sid: Supabase `session_id` claim'i (dev modunda dev oturumunun createdAt'i)
 *                          — çerez başka/yeni bir oturumla kullanılamaz.
 *   admin_login_pending  — şifre doğrulandı, kod bekleniyor { sub: çalışan id, sid: e-posta }; 10 dk.
 *
 * Biçim: base64url(JSON) + '.' + base64url(HMAC-SHA256). Anahtar: ADMIN_LOGIN_SECRET
 * (yoksa sunucuya özel SUPABASE_SECRET_KEY). Web Crypto kullanır: middleware (Edge) ve
 * route handler'larda aynı kod çalışır.
 */
import { ACCESS, type AccessLevel } from './roles'
import { SESSION_MAX_AGE } from './sessionAge'

export const ADMIN_VERIFIED_COOKIE = 'admin_verified'
export const ADMIN_PENDING_COOKIE = 'admin_login_pending'
/** Şifre ile kod arasında geçebilecek en uzun süre (saniye) */
export const ADMIN_PENDING_MAX_AGE = 10 * 60

/**
 * admin_device — "bu cihazda admin girişi yapıldı" işareti. Hiçbir yetki vermez; yalnızca oturumsuz
 * /login isteğinin admin giriş formuna yönlenmesini sağlar (PWA'da adres çubuğu yoktur, admin
 * /login/admin yazamaz). Çıkışta silinmez; bu cihazda çalışan girişi yapılınca silinir.
 */
export const ADMIN_DEVICE_COOKIE = 'admin_device'
/** Tarayıcıların izin verdiği en uzun çerez ömrü (400 gün) */
export const ADMIN_DEVICE_MAX_AGE = 400 * 24 * 60 * 60
/** /login?employee=1 — admin cihazında çalışan giriş formunu açar (bkz. middleware) */
export const EMPLOYEE_LOGIN_PARAM = 'employee'

type TokenKind = 'verified' | 'pending'

const MAX_AGE: Record<TokenKind, number> = {
  verified: SESSION_MAX_AGE,
  pending: ADMIN_PENDING_MAX_AGE,
}

interface TokenClaims {
  k: TokenKind
  sub: string
  sid: string
  iat: number
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

async function hmac(data: string): Promise<string | null> {
  const s = process.env.ADMIN_LOGIN_SECRET || process.env.SUPABASE_SECRET_KEY
  if (!s) return null
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  // Önek: aynı anahtarla imzalanan dev oturum çereziyle karıştırılamasın
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`admin-login:${data}`))
  return toBase64Url(new Uint8Array(sig))
}

/** Sabit zamanlı karşılaştırma */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function signAdminToken(kind: TokenKind, sub: string, sid: string, now = Date.now()): Promise<string> {
  const claims: TokenClaims = { k: kind, sub, sid, iat: now }
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)))
  const sig = await hmac(body)
  if (!sig) throw new Error('ADMIN_LOGIN_SECRET (veya SUPABASE_SECRET_KEY) tanımlı değil.')
  return `${body}.${sig}`
}

/** İmzası geçerli, türü doğru ve süresi dolmamış çerezin içeriği; değilse null */
export async function readAdminToken(
  value: string | undefined | null,
  kind: TokenKind,
  now = Date.now()
): Promise<{ sub: string; sid: string } | null> {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const body = value.slice(0, dot)
  const expected = await hmac(body)
  if (!expected || !safeEqual(value.slice(dot + 1), expected)) return null
  try {
    const c = JSON.parse(fromBase64Url(body)) as Partial<TokenClaims>
    if (c.k !== kind || typeof c.sub !== 'string' || typeof c.sid !== 'string' || typeof c.iat !== 'number') return null
    if (now - c.iat > MAX_AGE[kind] * 1000 || c.iat > now + 60_000) return null
    return { sub: c.sub, sid: c.sid }
  } catch {
    return null
  }
}

/**
 * Oturum admin girişi kuralını karşılıyor mu? Admin olmayanlar için her zaman true;
 * admin için bu çalışana ve bu oturuma ait geçerli ADMIN_VERIFIED_COOKIE gerekir.
 */
export async function passesAdminLogin(
  accessLevel: AccessLevel | null | undefined,
  cookie: string | undefined | null,
  employeeId: string,
  sessionId: string | null
): Promise<boolean> {
  if (accessLevel !== ACCESS.ADMIN) return true
  if (!sessionId) return false
  const token = await readAdminToken(cookie, 'verified')
  return !!token && token.sub === employeeId && token.sid === sessionId
}

/** Dev oturumunun admin çerezine bağlandığı kimlik */
export function devSessionId(createdAt: number): string {
  return `dev:${createdAt}`
}

/** Admin çerezlerinin ortak seçenekleri (HttpOnly; https'te secure) */
export function adminCookieOptions(secure: boolean, maxAge: number) {
  return { httpOnly: true, sameSite: 'lax' as const, path: '/', secure, maxAge }
}
