/**
 * QR Token Service — server-side only
 * Token üretimi ve doğrulaması için kullanılır.
 * Tüm fonksiyonlar admin (service role) Supabase client kullanır.
 */
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { QrToken, QrActionType, QrPayload, GenerateQrResponse } from '@/types/qr'

const DEFAULT_TTL_SECONDS = 60

// ============================================================
// Hata sınıfı
// ============================================================
export class QrTokenError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message)
    this.name = 'QrTokenError'
  }
}

// ============================================================
// Kriptografik token üretimi (Node.js crypto)
// ============================================================
function generateSecureToken(): string {
  // Node.js crypto — server-side only
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.randomBytes(32).toString('hex')
}

// ============================================================
// Token oluştur
// ============================================================
export async function generateQrToken(
  employeeId: string,
  actionType: QrActionType,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<GenerateQrResponse> {
  const admin = createAdminClient()

  const token = generateSecureToken()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

  const { data, error } = await admin
    .from('qr_tokens')
    .insert({
      token,
      action_type: actionType,
      employee_id: employeeId,
      expires_at: expiresAt,
    })
    .select()
    .single()

  if (error) {
    throw new QrTokenError(`QR token oluşturulamadı: ${error.message}`, 'DB_ERROR')
  }

  const record = data as QrToken

  // QR koda encode edilecek payload — hassas bilgi minimum
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

// ============================================================
// Token doğrula + kullanıldı olarak işaretle
// ============================================================
export async function validateAndConsumeToken(
  rawQrData: string
): Promise<{ token: QrToken; payload: QrPayload }> {
  // 1. QR verisini parse et
  let payload: QrPayload
  try {
    payload = JSON.parse(rawQrData) as QrPayload
  } catch {
    throw new QrTokenError('QR kod geçersiz format.', 'QR_INVALID')
  }

  if (!payload.token || !payload.action || !payload.employee_id) {
    throw new QrTokenError('QR kod eksik alan içeriyor.', 'QR_INVALID')
  }

  // 2. Client-side expiry pre-check (server zaten kontrol eder ama hızlı fail)
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    throw new QrTokenError('QR kodun süresi dolmuş.', 'QR_EXPIRED')
  }

  const admin = createAdminClient()

  // 3. DB'den token'ı al
  const { data: tokenRow, error: fetchError } = await admin
    .from('qr_tokens')
    .select('*')
    .eq('token', payload.token)
    .maybeSingle()

  if (fetchError) {
    throw new QrTokenError('QR token sorgulanamadı.', 'DB_ERROR')
  }

  if (!tokenRow) {
    throw new QrTokenError('QR kod bulunamadı veya geçersiz.', 'QR_INVALID')
  }

  const record = tokenRow as QrToken

  // 4. Kullanılmış mı?
  if (record.used_at) {
    throw new QrTokenError('Bu QR kod daha önce kullanılmış.', 'QR_USED')
  }

  // 5. Süresi dolmuş mu? (server-side kesin kontrol)
  if (new Date(record.expires_at) <= new Date()) {
    throw new QrTokenError('QR kodun süresi dolmuş.', 'QR_EXPIRED')
  }

  // 6. Action tipi payload ile eşleşiyor mu?
  if (record.action_type !== payload.action) {
    throw new QrTokenError('QR aksiyon tipi uyumsuz.', 'QR_WRONG_ACTION')
  }

  // 7. employee_id eşleşiyor mu?
  if (record.employee_id !== payload.employee_id) {
    throw new QrTokenError('QR koda ait çalışan bulunamadı.', 'QR_INVALID')
  }

  // 8. Token'ı kullanıldı olarak işaretle (tek kullanım)
  const { error: updateError } = await admin
    .from('qr_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', record.id)

  if (updateError) {
    throw new QrTokenError('QR token güncellenemedi.', 'DB_ERROR')
  }

  return { token: record, payload }
}

// ============================================================
// Süresi dolmuş token'ları temizle (periyodik çağrılabilir)
// ============================================================
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
