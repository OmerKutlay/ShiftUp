/**
 * QR Token Service — server-side only
 *
 * İki tür QR token:
 *   1. Kiosk QR (evrensel): employee_id=null, action_type=null
 *      → Kiosk'ta asılı durur, herhangi biri tarar
 *      → process sırasında authenticated employee + state machine belirlenir
 *
 *   2. Klasik QR (employee bazlı): employee_id + action_type dolu
 *      → Geriye dönük uyumluluk için korunur
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
 * Kiosk (evrensel) QR token üretir.
 * employee_id ve action_type içermez — process'te belirlenir.
 */
export async function generateKioskQrToken(
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<GenerateQrResponse> {
  const admin = createAdminClient()
  const token = generateSecureToken()
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

  const { data, error } = await admin
    .from('qr_tokens')
    .insert({ token, action_type: null, employee_id: null, expires_at: expiresAt })
    .select()
    .single()

  if (error) throw new QrTokenError(`Kiosk QR token oluşturulamadı: ${error.message}`, 'DB_ERROR')

  const record = data as QrToken

  // QR payload — employee ve action içermez, sadece token + exp
  const qrPayload: KioskQrPayload = {
    token: record.token,
    kiosk: true,
    exp: Math.floor(new Date(expiresAt).getTime() / 1000),
  }

  return {
    token: record.token,
    action_type: null,
    employee_id: null,
    expires_at: expiresAt,
    qr_data: JSON.stringify(qrPayload),
  }
}

/**
 * Klasik QR token üretir (employee bazlı, geriye dönük uyumluluk).
 */
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
    .insert({ token, action_type: actionType, employee_id: employeeId, expires_at: expiresAt })
    .select()
    .single()

  if (error) throw new QrTokenError(`QR token oluşturulamadı: ${error.message}`, 'DB_ERROR')

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
  isKiosk: boolean         // true → employee_id & action_type yok, session'dan alınacak
  payload: QrPayload | KioskQrPayload
}

export interface KioskQrPayload {
  token: string
  kiosk: true
  exp: number
}

export async function validateAndConsumeToken(rawQrData: string): Promise<ValidatedToken> {
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

  const isKiosk = rawPayload.kiosk === true

  // Klasik QR için erken alan kontrolü — DB'ye gitmeden önce
  if (!isKiosk) {
    const payload = rawPayload as unknown as QrPayload
    if (!payload.action || !payload.employee_id) {
      throw new QrTokenError('QR kod eksik alan içeriyor.', 'QR_INVALID')
    }
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

  if (record.used_at) throw new QrTokenError('Bu QR kod daha önce kullanılmış.', 'QR_USED')
  if (new Date(record.expires_at) <= new Date()) throw new QrTokenError('QR kodun süresi dolmuş.', 'QR_EXPIRED')

  // Klasik QR için ek doğrulamalar (action/employee eşleşme)
  if (!isKiosk) {
    const payload = rawPayload as unknown as QrPayload
    if (record.action_type && record.action_type !== payload.action) {
      throw new QrTokenError('QR aksiyon tipi uyumsuz.', 'QR_WRONG_ACTION')
    }
    if (record.employee_id && record.employee_id !== payload.employee_id) {
      throw new QrTokenError('QR koda ait çalışan bulunamadı.', 'QR_INVALID')
    }
  }

  // 4. Tek kullanım işaretle
  const { error: updateError } = await admin
    .from('qr_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', record.id)

  if (updateError) throw new QrTokenError('QR token güncellenemedi.', 'DB_ERROR')

  return {
    token: record,
    isKiosk,
    payload: isKiosk
      ? (rawPayload as unknown as KioskQrPayload)
      : (rawPayload as unknown as QrPayload),
  }
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
