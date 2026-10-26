/**
 * QR Token Service — server-side only
 *
 * Klasik QR (employee bazlı): employee_id + action_type dolu, tek kullanımlık, DB'de saklanır.
 *
 * Kiosk QR'ları artık sunucuda üretilmez: kiosk ekranı imzalama anahtarıyla kodu yerelde
 * üretir ve /api/qr/process kioskKeyService.verifyKioskQr ile doğrular.
 */
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { QrToken, QrActionType, QrPayload, GenerateQrResponse } from '@/types/qr'

const DEFAULT_TTL_SECONDS = 60

// ─── Hata sınıfı ─────────────────────────────────────────────
export class QrTokenError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = 'QrTokenError'
  }
}

// ─── Token üretimi ────────────────────────────────────────────
function generateSecureToken(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Klasik QR token üretir (employee bazlı, geriye dönük uyumluluk).
 * storeId: çalışanın mağazası (kayıt/denetim için token'a yazılır).
 */
export async function generateQrToken(
  employeeId: string,
  actionType: QrActionType,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  storeId: string | null = null
): Promise<GenerateQrResponse> {
  const admin = createAdminClient()
  const token = generateSecureToken()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

  const { data, error } = await admin
    .from('qr_tokens')
    .insert({ token, action_type: actionType, employee_id: employeeId, store_id: storeId, expires_at: expiresAt })
    .select()
    .single()

  if (error) {
    console.error('[qrTokenService] insert:', error.message)
    throw new QrTokenError('QR token oluşturulamadı.', 'DB_ERROR')
  }

  const record = data as QrToken
  const qrPayload: QrPayload = {
    token: record.token,
    action: actionType,
    employee_id: employeeId,
    exp: Math.floor(new Date(expiresAt).getTime() / 1000),
  }

  return {
    token: record.token,
    action_type: actionType,
    employee_id: employeeId,
    expires_at: expiresAt,
    qr_data: JSON.stringify(qrPayload),
  }
}

// ─── Token doğrulama ──────────────────────────────────────────

export interface ValidatedToken {
  token: QrToken
  payload: QrPayload
}

/**
 * Okutan kişi — verilirse sahiplik ve mağaza token TÜKETİLMEDEN önce doğrulanır; böylece başkasının
 * kodunu (ör. ekran görüntüsünden) okutmaya çalışan biri o kodu geçersiz kılamaz.
 */
export interface QrScanner {
  employeeId: string
  storeId: string
}

export async function validateAndConsumeToken(rawQrData: string, scanner?: QrScanner): Promise<ValidatedToken> {
  // 1. Parse
  let rawPayload: Record<string, unknown>
  try {
    rawPayload = JSON.parse(rawQrData) as Record<string, unknown>
  } catch {
    throw new QrTokenError('QR kod geçersiz format.', 'QR_INVALID')
  }

  if (!rawPayload.token || typeof rawPayload.token !== 'string') {
    throw new QrTokenError('QR kod eksik alan içeriyor.', 'QR_INVALID')
  }

  // Erken alan kontrolü — DB'ye gitmeden önce
  const payload = rawPayload as unknown as QrPayload
  if (!payload.action || !payload.employee_id) {
    throw new QrTokenError('QR kod eksik alan içeriyor.', 'QR_INVALID')
  }

  // 2. Client-side expiry pre-check
  const exp = rawPayload.exp as number | undefined
  if (exp && Date.now() / 1000 > exp) {
    throw new QrTokenError('QR kodun süresi dolmuş.', 'QR_EXPIRED')
  }

  // 3. DB'den token'ı al
  const admin = createAdminClient()
  const { data: tokenRow, error: fetchError } = await admin
    .from('qr_tokens')
    .select('*')
    .eq('token', rawPayload.token)
    .maybeSingle()

  if (fetchError) throw new QrTokenError('QR token sorgulanamadı.', 'DB_ERROR')
  if (!tokenRow) throw new QrTokenError('QR kod bulunamadı veya geçersiz.', 'QR_INVALID')

  const record = tokenRow as QrToken

  // Kiosk kodları (employee_id NULL) yalnızca kiosk akışında tüketilir; klasik yoldan okutulursa
  // yeni kod yayınlanmadan tükenir ve kiosk ekranı geçersiz bir kod göstermeye devam ederdi
  if (!record.employee_id) throw new QrTokenError('QR kod bulunamadı veya geçersiz.', 'QR_INVALID')

  if (scanner) {
    if (record.employee_id !== scanner.employeeId) {
      throw new QrTokenError('Bu QR kodu size ait değil. Başkası adına okutamazsınız.', 'QR_NOT_OWNER')
    }
    if (record.store_id && record.store_id !== scanner.storeId) {
      throw new QrTokenError('Bu QR kodu başka bir mağazaya ait.', 'QR_WRONG_STORE')
    }
  }

  if (record.used_at) throw new QrTokenError('Bu QR kod daha önce kullanılmış.', 'QR_USED')
  if (new Date(record.expires_at) <= new Date()) throw new QrTokenError('QR kodun süresi dolmuş.', 'QR_EXPIRED')

  // Action/employee eşleşme
  if (record.action_type && record.action_type !== payload.action) {
    throw new QrTokenError('QR aksiyon tipi uyumsuz.', 'QR_WRONG_ACTION')
  }
  if (record.employee_id && record.employee_id !== payload.employee_id) {
    throw new QrTokenError('QR koda ait çalışan bulunamadı.', 'QR_INVALID')
  }

  // 4. Tek kullanım işaretle — atomik: yalnızca hâlâ kullanılmamış ve süresi
  // dolmamışsa güncellenir. Eşzamanlı iki okutmadan yalnızca biri kazanır.
  const nowIso = new Date().toISOString()
  const { data: consumed, error: updateError } = await admin
    .from('qr_tokens')
    .update({ used_at: nowIso })
    .eq('id', record.id)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('id')
    .maybeSingle()

  if (updateError) throw new QrTokenError('QR token güncellenemedi.', 'DB_ERROR')
  if (!consumed) throw new QrTokenError('Bu QR kod daha önce kullanılmış.', 'QR_USED')

  return { token: record, payload }
}

// ─── Temizlik ─────────────────────────────────────────────────
export async function purgeExpiredTokens(): Promise<number> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('qr_tokens')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('id')
  if (error) throw new QrTokenError('Eski token temizlenemedi.', 'DB_ERROR')
  return (data ?? []).length
}
