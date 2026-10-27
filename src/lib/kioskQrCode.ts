/**
 * kioskQrCode — Kiosk QR kodunun biçimi ve üretimi (tarayıcı + sunucu, WebCrypto).
 *
 * Kiosk ekranı sunucudan kısa ömürlü bir "kiosk anahtarı" (KioskSeed) alır ve kodu her
 * KIOSK_QR_STEP_MS'de bir YEREL olarak üretir: istek yok, veritabanı yükü yok.
 *
 *   kod = SU3.<store_id>.<issuer_id>.<exp>.<pencere>.<mac>
 *   mac = base64url(HMAC-SHA256(anahtar, "<pencere>"))[:16 bayt]
 *   pencere = floor(zaman / KIOSK_QR_STEP_MS)
 *
 * Anahtar sunucuda HMAC(sunucu sırrı, "SU3|store|issuer|exp") olarak türetilir; sunucu kodu
 * aynı yoldan yeniden hesaplayarak doğrular (bkz. kioskQrService.verifyKioskQr). Kodun
 * fotoğrafı en fazla ~1,5 dakika geçerlidir.
 *
 * Bu dosya sunucuya özel bir şey içe aktarmamalıdır (istemci bileşeni de kullanır).
 */

export const KIOSK_QR_PREFIX = 'SU3'
/** Kodun yenilenme aralığı */
export const KIOSK_QR_STEP_MS = 60 * 1000

/** GET /api/kiosk/qr yanıtındaki kiosk anahtarı */
export interface KioskSeed {
  store_id: string
  /** Anahtarı alan oturumdaki çalışan (kiosk hesabı / yönetici) */
  issuer_id: string
  /** Anahtarın geçerlilik sonu (Unix saniye) */
  expires_at: number
  /** base64url, 32 bayt */
  secret: string
}

export interface ParsedKioskQr {
  storeId: string
  issuerId: string
  expiresAt: number
  window: number
  mac: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAC_RE = /^[A-Za-z0-9_-]{22}$/
const INT_RE = /^\d{1,12}$/

const encoder = new TextEncoder()

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function hmacSha256(key: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)))
}

export function kioskQrWindow(nowMs: number): number {
  return Math.floor(nowMs / KIOSK_QR_STEP_MS)
}

/** Anahtar ve pencere için kodun imza kısmı */
export async function kioskQrMac(secret: Uint8Array, window: number): Promise<string> {
  const sig = await hmacSha256(secret, String(window))
  return base64UrlEncode(sig.slice(0, 16))
}

/** Kiosk ekranında gösterilecek güncel kod */
export async function computeKioskQr(seed: KioskSeed, nowMs: number): Promise<string> {
  const window = kioskQrWindow(nowMs)
  const mac = await kioskQrMac(base64UrlDecode(seed.secret), window)
  return [KIOSK_QR_PREFIX, seed.store_id, seed.issuer_id, seed.expires_at, window, mac].join('.')
}

export function isKioskQr(qrData: string): boolean {
  return qrData.startsWith(`${KIOSK_QR_PREFIX}.`)
}

/** Biçim kontrolü — imzayı DOĞRULAMAZ */
export function parseKioskQr(qrData: string): ParsedKioskQr | null {
  const parts = qrData.split('.')
  if (parts.length !== 6 || parts[0] !== KIOSK_QR_PREFIX) return null
  const [, storeId, issuerId, exp, window, mac] = parts
  if (!UUID_RE.test(storeId) || !UUID_RE.test(issuerId)) return null
  if (!INT_RE.test(exp) || !INT_RE.test(window) || !MAC_RE.test(mac)) return null
  return { storeId, issuerId, expiresAt: Number(exp), window: Number(window), mac }
}
