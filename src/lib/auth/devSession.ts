/**
 * devSession — AUTH_MODE=development oturum çerezinin imzalanması.
 *
 * Çerez biçimi: base64url(JSON payload) + '.' + base64url(HMAC-SHA256)
 * İmzasız / değiştirilmiş / süresi dolmuş çerez reddedilir; böylece istemci
 * başka bir çalışanın id'sini yazarak oturum taklit edemez.
 *
 * Anahtar: DEV_SESSION_SECRET (yoksa sunucuya özel SUPABASE_SECRET_KEY).
 * Yalnızca server tarafında (route handler, proxy — Node.js runtime) kullanılır.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { DEV_SESSION_MAX_AGE } from '@/lib/authConfig'

export interface DevSessionPayload {
  employeeId: string
  createdAt: number
}

function secret(): string {
  const s = process.env.DEV_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY
  if (!s) throw new Error('DEV_SESSION_SECRET (veya SUPABASE_SECRET_KEY) tanımlı değil.')
  return s
}

function hmac(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url')
}

export function signDevSession(payload: DevSessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(body)}`
}

export function verifyDevSession(value: string | undefined | null): DevSessionPayload | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const body = value.slice(0, dot)
  const sig = value.slice(dot + 1)

  let expected: string
  try {
    expected = hmac(body)
  } catch {
    return null
  }
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<DevSessionPayload>
    if (typeof payload.employeeId !== 'string' || typeof payload.createdAt !== 'number') return null
    if (Date.now() - payload.createdAt > DEV_SESSION_MAX_AGE * 1000) return null
    return { employeeId: payload.employeeId, createdAt: payload.createdAt }
  } catch {
    return null
  }
}
