/**
 * kioskKeyService — Kiosk'un yerelde ürettiği imzalı QR kodları (sunucu tarafı).
 *
 * Token katmanları:
 *   - Refresh: kiosk hesabının Supabase Auth oturumu (httpOnly çerez, middleware'de döner).
 *   - Access : kısa ömürlü imzalama anahtarı (kiosk_keys). Kiosk yalnızca bellekte tutar,
 *              süresi dolmadan /api/kiosk/key ile yenisini alır (saatte ~1 istek).
 *   - QR     : "SU1.<key_id>.<step>.<sig>" — step = floor(unix_ms / 15 sn),
 *              sig = base64url(HMAC-SHA256(secret, "SU1.<key_id>.<step>"))[0..22] (~128 bit).
 *
 * Doğrulama: imza + anahtarın sahibi aktif bir kiosk/yönetici + anahtar iptal/süresi dolmamış
 * + pencere şu an ±1 adım (en fazla ~30 sn) + aynı çalışan aynı kodu ikinci kez kullanamaz.
 * Ekran fotoğrafıyla uzaktan okutma penceresi eski modeldeki 30 sn TTL ile aynıdır;
 * konum (geofence) kontrolü /api/qr/process'te ayrıca yapılır.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { QrTokenError } from '@/lib/qrTokenService'
import { isKioskRole, roleAtLeast, ROLES } from '@/lib/auth/roles'

export const KIOSK_QR_PREFIX = 'SU1'
export const KIOSK_STEP_SECONDS = 15
/** Access anahtarının ömrü — kiosk bitmeden ~5 dk önce yeniler */
export const KIOSK_KEY_TTL_SECONDS = 60 * 60
/** Saat kayması / okutma gecikmesi toleransı (adım) */
const STEP_TOLERANCE = 1
const SIG_LENGTH = 22

export interface KioskKey {
  key_id: string
  /** base64url, 32 bayt */
  secret: string
  expires_at: string
  step_seconds: number
  /** Kiosk saat farkını düzeltmek için sunucu zamanı (ms) */
  server_time: number
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / (KIOSK_STEP_SECONDS * 1000))
}

export function signKioskQr(secret: string, keyId: string, step: number): string {
  const body = `${KIOSK_QR_PREFIX}.${keyId}.${step}`
  const sig = createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url')
  return `${body}.${sig.slice(0, SIG_LENGTH)}`
}

export function isKioskQr(qrData: string): boolean {
  return qrData.startsWith(`${KIOSK_QR_PREFIX}.`)
}

/** Kiosk hesabı veya Müdür Yardımcısı+ imzalama anahtarı alabilir */
export function canIssueKioskKey(roleName: string | null | undefined): boolean {
  return isKioskRole(roleName) || (!!roleName && roleAtLeast(roleName, ROLES.MUDUR_YARDIMCISI))
}

export async function issueKioskKey(admin: SupabaseClient, employeeId: string, nowMs = Date.now()): Promise<KioskKey> {
  const secret = randomBytes(32).toString('base64url')
  const expiresAt = new Date(nowMs + KIOSK_KEY_TTL_SECONDS * 1000).toISOString()

  const { data, error } = await admin
    .from('kiosk_keys')
    .insert({ employee_id: employeeId, secret, expires_at: expiresAt })
    .select('id')
    .single()
  if (error || !data) throw new QrTokenError('Kiosk anahtarı oluşturulamadı.', 'DB_ERROR')

  // Süresi dolalı 1 günü geçen anahtarları temizle (qr_scan_uses cascade ile silinir)
  if (Math.random() < 0.1) {
    const cutoff = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()
    await admin.from('kiosk_keys').delete().lt('expires_at', cutoff)
  }

  return {
    key_id: data.id as string,
    secret,
    expires_at: expiresAt,
    step_seconds: KIOSK_STEP_SECONDS,
    server_time: nowMs,
  }
}

export interface VerifiedKioskQr {
  keyId: string
  step: number
}

/** İmzayı ve pencereyi doğrular; hiçbir şey yazmaz (tüketim: markKioskQrUsed) */
export async function verifyKioskQr(
  admin: SupabaseClient,
  qrData: string,
  nowMs = Date.now()
): Promise<VerifiedKioskQr> {
  const parts = qrData.split('.')
  if (parts.length !== 4 || parts[0] !== KIOSK_QR_PREFIX) throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')
  const [, keyId, stepRaw, sig] = parts
  if (!/^[0-9a-f-]{36}$/i.test(keyId) || !/^\d{1,12}$/.test(stepRaw) || sig.length !== SIG_LENGTH) {
    throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')
  }
  const step = Number(stepRaw)

  const now = currentStep(nowMs)
  if (step < now - STEP_TOLERANCE) throw new QrTokenError('QR kodunun süresi dolmuş. Kiosk ekranındaki güncel kodu okutun.', 'QR_EXPIRED')
  if (step > now + STEP_TOLERANCE) throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')

  const { data: key, error } = await admin
    .from('kiosk_keys')
    .select('id, secret, expires_at, revoked_at, employees!kiosk_keys_employee_id_fkey ( active, roles ( name ) )')
    .eq('id', keyId)
    .maybeSingle()
  if (error) throw new QrTokenError('QR doğrulanamadı.', 'DB_ERROR')
  if (!key) throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')

  const expected = signKioskQr(key.secret as string, keyId, step)
  const a = Buffer.from(qrData)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')

  // Anahtar, ait olduğu pencere başlamadan önce geçerli olmalı; iptal edilmiş olmamalı
  const stepStartMs = step * KIOSK_STEP_SECONDS * 1000
  if (key.revoked_at || new Date(key.expires_at as string).getTime() <= stepStartMs) {
    throw new QrTokenError('QR kodunun süresi dolmuş. Kiosk ekranındaki güncel kodu okutun.', 'QR_EXPIRED')
  }

  // Anahtarı alan hesap pasifleştirildi / yetkisi alındıysa kodları da geçersizdir
  const owner = key.employees as unknown as { active: boolean; roles: { name: string } | { name: string }[] | null } | null
  const roles = owner?.roles
  const ownerRole = Array.isArray(roles) ? roles[0]?.name ?? null : roles?.name ?? null
  if (!owner?.active || !canIssueKioskKey(ownerRole)) throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')

  return { keyId, step }
}

/** Aynı çalışan aynı kodu (anahtar + pencere) yalnızca bir kez kullanabilir — atomik */
export async function markKioskQrUsed(
  admin: SupabaseClient,
  qr: VerifiedKioskQr,
  employeeId: string
): Promise<void> {
  const { error } = await admin
    .from('qr_scan_uses')
    .insert({ key_id: qr.keyId, time_step: qr.step, employee_id: employeeId })
  if (!error) return
  if (error.code === '23505') throw new QrTokenError('Bu QR kodu zaten kullanıldı. Yeni kodu bekleyin.', 'QR_USED')
  throw new QrTokenError('QR doğrulanamadı.', 'DB_ERROR')
}
