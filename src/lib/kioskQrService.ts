/**
 * kioskQrService — Kiosk QR anahtarı ve kod doğrulama (sunucu tarafı).
 *
 * Akış:
 *   - Kiosk / yönetici ekranı açılışta GET /api/kiosk/qr ile mağazası için kısa ömürlü bir
 *     anahtar (KioskSeed, KIOSK_SEED_TTL_MS) alır; anahtar bitmeden yenisini ister.
 *   - Kod tarayıcıda her dakika yerelde üretilir (bkz. kioskQrCode) — periyodik istek, veritabanı
 *     yazımı veya Realtime yayını yoktur.
 *   - Okutmada (POST /api/qr/process) sunucu anahtarı kendi sırrından yeniden türetip imzayı,
 *     mağazayı ve zaman penceresini doğrular. Kodun fotoğrafı ~1,5 dakika sonra geçersizdir.
 *   - Anahtarı alan çalışan (issuer) okutma anında hâlâ aktif ve yetkili olmalıdır; pasifleştirilen
 *     kiosk hesabının anahtarı hemen geçersizleşir.
 *   - Kendi oturumundan alınan anahtarla üretilen kod okutulamaz: yönetici evde kiosk ekranını açıp
 *     kendi telefonuyla okutarak uzaktan giriş yapamaz.
 *
 * Sunucu sırrı: KIOSK_QR_SECRET (yoksa SUPABASE_SECRET_KEY'den türetilir). Değiştirilirse açık kiosk
 * ekranlarının anahtarı geçersizleşir; ekranlar yeni anahtarı otomatik alır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { QrTokenError } from '@/lib/qrTokenService'
import { isKioskRole, roleAtLeast, ACCESS, accessLevelOf, type AccessLevel } from '@/lib/auth/roles'
import { isEffectivelyActive } from '@/lib/employment'
import {
  KIOSK_QR_STEP_MS,
  base64UrlEncode,
  hmacSha256,
  kioskQrMac,
  parseKioskQr,
  type KioskSeed,
} from '@/lib/kioskQrCode'

/** Kiosk anahtarının ömrü — ekran bitmeden yenisini alır (günde birkaç istek) */
export const KIOSK_SEED_TTL_MS = 12 * 60 * 60 * 1000
/** Kod, penceresi bittikten sonra bu kadar daha kabul edilir (okutma + ağ gecikmesi) */
const KIOSK_QR_GRACE_MS = 30 * 1000
/** Kiosk saatinin sunucudan ileride olmasına tolerans (ekran sunucu saatine göre düzeltilir) */
const KIOSK_QR_CLOCK_SKEW_MS = 10 * 1000

const encoder = new TextEncoder()

/**
 * Kiosk QR'ını görebilir / anahtar alabilir mi?
 *   - Admin: her mağaza
 *   - Kiosk / Yönetici / Müdür: yalnızca kendi (ana) mağazası
 */
export function canViewKioskQr(
  accessLevel: AccessLevel | null | undefined,
  homeStoreId: string | null | undefined,
  storeId: string | null | undefined,
): boolean {
  if (!accessLevel || !storeId) return false
  if (accessLevel === ACCESS.ADMIN) return true
  const allowedLevel = isKioskRole(accessLevel) || roleAtLeast(accessLevel, ACCESS.MANAGER)
  return allowedLevel && !!homeStoreId && homeStoreId === storeId
}

let masterKeyPromise: Promise<Uint8Array> | null = null
let masterKeySource: string | null = null

/** Sunucu sırrı → 32 baytlık ana anahtar (ortam değişkeni değişirse yeniden türetilir) */
function masterKey(): Promise<Uint8Array> {
  const raw = process.env.KIOSK_QR_SECRET || process.env.SUPABASE_SECRET_KEY
  if (!raw) throw new QrTokenError('Kiosk QR sırrı tanımlı değil.', 'DB_ERROR')
  if (!masterKeyPromise || masterKeySource !== raw) {
    masterKeySource = raw
    masterKeyPromise = hmacSha256(encoder.encode(raw), 'shiftup:kiosk-qr:v3')
  }
  return masterKeyPromise
}

async function deriveSeedSecret(storeId: string, issuerId: string, expiresAt: number): Promise<Uint8Array> {
  return hmacSha256(await masterKey(), `SU3|${storeId.toLowerCase()}|${issuerId.toLowerCase()}|${expiresAt}`)
}

/** Kiosk ekranına verilecek anahtar */
export async function issueKioskSeed(storeId: string, issuerId: string, nowMs = Date.now()): Promise<KioskSeed> {
  const expiresAt = Math.floor((nowMs + KIOSK_SEED_TTL_MS) / 1000)
  const secret = await deriveSeedSecret(storeId, issuerId, expiresAt)
  return { store_id: storeId, issuer_id: issuerId, expires_at: expiresAt, secret: base64UrlEncode(secret) }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Kiosk kodunu doğrular (imza, mağaza, zaman, okutan ≠ anahtarı alan). Veritabanına gitmez.
 * Dönüş: anahtarı alan çalışanın kimliği — çağıran verifyKioskIssuer ile yetkisini doğrular.
 */
export async function verifyKioskQr(
  qrData: string,
  { storeId, scannerId, nowMs = Date.now() }: { storeId: string; scannerId: string; nowMs?: number }
): Promise<{ issuerId: string }> {
  const parsed = parseKioskQr(qrData)
  if (!parsed) throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')

  const secret = await deriveSeedSecret(parsed.storeId, parsed.issuerId, parsed.expiresAt)
  const expected = await kioskQrMac(secret, parsed.window)
  if (!constantTimeEqual(parsed.mac, expected)) throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')

  // İmza geçerli: alanlar sunucunun ürettiği değerlerdir
  if (parsed.storeId.toLowerCase() !== storeId.toLowerCase()) {
    throw new QrTokenError('Bu QR kodu başka bir mağazaya ait.', 'QR_WRONG_STORE')
  }
  const windowStart = parsed.window * KIOSK_QR_STEP_MS
  if (windowStart > nowMs + KIOSK_QR_CLOCK_SKEW_MS) {
    throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')
  }
  if (nowMs >= windowStart + KIOSK_QR_STEP_MS + KIOSK_QR_GRACE_MS || windowStart >= parsed.expiresAt * 1000) {
    throw new QrTokenError('QR kodunun süresi doldu. Ekrandaki güncel kodu okutun.', 'QR_EXPIRED')
  }
  if (parsed.issuerId.toLowerCase() === scannerId.toLowerCase()) {
    throw new QrTokenError(
      'Kendi oturumunuzda açılan kiosk ekranının kodunu okutamazsınız. Mağazadaki kiosk ekranını kullanın.',
      'QR_SELF_ISSUED'
    )
  }
  return { issuerId: parsed.issuerId }
}

/** Anahtarı alan hesap okutma anında hâlâ aktif ve bu mağazanın kiosk kodunu görmeye yetkili mi? */
export async function verifyKioskIssuer(admin: SupabaseClient, issuerId: string, storeId: string): Promise<void> {
  const { data, error } = await admin
    .from('employees')
    .select('id, active, store_id, termination_date, roles ( access_level )')
    .eq('id', issuerId)
    .maybeSingle()
  if (error) throw new QrTokenError('QR doğrulanamadı.', 'DB_ERROR')
  const level = accessLevelOf((data as { roles?: unknown } | null)?.roles)
  if (!data || !isEffectivelyActive(data) || !canViewKioskQr(level, data.store_id as string, storeId)) {
    throw new QrTokenError('Kiosk ekranının oturumu geçersiz. Kiosk ekranını yeniden açın.', 'QR_INVALID')
  }
}
