/**
 * kioskQrService — Tek kullanımlık kiosk QR'ı + Supabase Realtime Broadcast (sunucu tarafı).
 *
 * Akış:
 *   - Her mağazanın her an tek bir aktif kiosk QR'ı vardır (qr_tokens: employee_id NULL,
 *     used_at NULL, store_id = mağaza — kısmi unique index ile garanti). QR zamanla değişmez;
 *     yalnızca okutulunca değişir. Bir mağazanın kodu başka mağazada geçersizdir.
 *   - Kiosk / yönetici ekranı açılışta (ve Realtime yeniden bağlandığında) GET /api/kiosk/qr ile
 *     güncel kodu ve kanal adını bir kez alır, sonra private "kiosk-qr:<store_id>" kanalını
 *     dinler. Periyodik istek yoktur.
 *   - Okutma onaylanınca kod atomik olarak tüketilir (aynı anda okutanlardan yalnızca ilki
 *     kazanır), yeni kod üretilir ve REST üzerinden mağazanın kanalına yayınlanır.
 *
 * Kanal güvenliği: Realtime "private_only" + realtime.messages RLS politikası
 * (public.can_view_kiosk_qr_topic: admin her mağaza; Kiosk / Yönetici / Müdür yalnızca kendi
 * mağazası). İstemcilerin kanala mesaj göndermesine izin veren politika yoktur; yalnızca
 * sunucu (secret key) yayınlar.
 */
import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { QrTokenError } from '@/lib/qrTokenService'
import { isKioskRole, roleAtLeast, ACCESS, type AccessLevel } from '@/lib/auth/roles'

/** Realtime kanal öneki; tam ad mağaza başınadır: "kiosk-qr:<store_id>" */
export const KIOSK_QR_TOPIC_PREFIX = 'kiosk-qr'
export const KIOSK_QR_EVENT = 'qr'
export const KIOSK_QR_PREFIX = 'SU2'
/** Kiosk QR'ı zamanla değil okutmayla değişir; expires_at yalnızca terk edilmiş kodlar için üst sınır */
const KIOSK_QR_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

export interface KioskQr {
  qr_data: string
}

/** Mağazanın kiosk Realtime kanalı (SQL: can_view_kiosk_qr_topic ile aynı biçim) */
export function kioskQrTopic(storeId: string): string {
  return `${KIOSK_QR_TOPIC_PREFIX}:${storeId}`
}

/**
 * Kiosk QR'ını görebilir / kanala katılabilir mi? SQL kuralının (can_view_kiosk_qr_topic) aynısı:
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

export function isKioskQr(qrData: string): boolean {
  return qrData.startsWith(`${KIOSK_QR_PREFIX}.`)
}

function toQrData(token: string): string {
  return `${KIOSK_QR_PREFIX}.${token}`
}

/** Mağazanın güncel aktif kiosk QR'ı; yoksa oluşturur (eşzamanlı oluşturmada unique index tek kodu garanti eder) */
export async function getOrCreateActiveKioskQr(admin: SupabaseClient, storeId: string): Promise<KioskQr> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: active, error } = await admin
      .from('qr_tokens')
      .select('token')
      .eq('store_id', storeId)
      .is('employee_id', null)
      .is('used_at', null)
      .limit(1)
      .maybeSingle()
    if (error) throw new QrTokenError('Kiosk QR okunamadı.', 'DB_ERROR')
    if (active) return { qr_data: toQrData(active.token as string) }

    const token = randomBytes(24).toString('base64url')
    const { error: insertError } = await admin.from('qr_tokens').insert({
      token,
      employee_id: null,
      store_id: storeId,
      action_type: null,
      expires_at: new Date(Date.now() + KIOSK_QR_MAX_AGE_MS).toISOString(),
    })
    if (!insertError) return { qr_data: toQrData(token) }
    // 23505: başka bir istek aynı anda aktif kodu oluşturdu — onu oku
    if (insertError.code !== '23505') throw new QrTokenError('Kiosk QR oluşturulamadı.', 'DB_ERROR')
  }
  throw new QrTokenError('Kiosk QR oluşturulamadı.', 'DB_ERROR')
}

/**
 * Okutulan kiosk QR'ını atomik olarak tüketir. Aynı kodu aynı anda okutanlardan yalnızca
 * ilki başarılı olur; diğerleri QR_USED alır. Kod, okutan çalışanın mağazasına (storeId) ait
 * olmalıdır; başka mağazanın kodu tüketilmez ve QR_WRONG_STORE ile reddedilir.
 */
export async function consumeKioskQr(admin: SupabaseClient, qrData: string, storeId: string): Promise<void> {
  const token = qrData.slice(KIOSK_QR_PREFIX.length + 1)
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')

  const nowIso = new Date().toISOString()
  const { data: consumed, error } = await admin
    .from('qr_tokens')
    .update({ used_at: nowIso })
    .eq('token', token)
    .eq('store_id', storeId)
    .is('employee_id', null)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('id')
    .maybeSingle()
  if (error) throw new QrTokenError('QR doğrulanamadı.', 'DB_ERROR')
  if (consumed) return

  const { data: existing } = await admin
    .from('qr_tokens')
    .select('used_at, store_id')
    .eq('token', token)
    .is('employee_id', null)
    .maybeSingle()
  if (existing && existing.store_id !== storeId) {
    throw new QrTokenError('Bu QR kodu başka bir mağazaya ait.', 'QR_WRONG_STORE')
  }
  if (existing?.used_at) {
    throw new QrTokenError('Bu QR kodu az önce okutuldu. Ekrandaki yeni kodu okutun.', 'QR_USED')
  }
  throw new QrTokenError('Geçersiz QR kodu.', 'QR_INVALID')
}

/** Mağazanın yeni aktif kodunu üretir ve o mağazanın abonelerine yayınlar. Yayın hatası okutmayı bozmaz (loglanır). */
export async function rotateAndBroadcastKioskQr(admin: SupabaseClient, storeId: string): Promise<KioskQr> {
  const next = await getOrCreateActiveKioskQr(admin, storeId)

  const channel = admin.channel(kioskQrTopic(storeId), { config: { private: true } })
  try {
    await channel.httpSend(KIOSK_QR_EVENT, next)
  } catch (err) {
    console.error('[kioskQrService] broadcast:', err instanceof Error ? err.message : err)
  } finally {
    void admin.removeChannel(channel)
  }

  // Kullanılmış eski kiosk kodlarını ara sıra temizle
  if (Math.random() < 0.05) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    await admin.from('qr_tokens').delete().eq('store_id', storeId).is('employee_id', null).lt('used_at', cutoff)
  }
  return next
}
