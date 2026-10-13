/**
 * devSessionEdge — dev_auth_session çerezinin Edge runtime'da (middleware) doğrulanması.
 *
 * devSession.ts ile aynı biçim ve anahtar: base64url(JSON payload) + '.' + base64url(HMAC-SHA256).
 * Node 'crypto' / Buffer yerine Web Crypto kullanır; middleware Edge'de çalıştığı için
 * (Cloudflare Worker paket boyutu) Node sürümü buradan import edilemez.
 */
import { DEV_SESSION_MAX_AGE } from '@/lib/authConfig'
import type { DevSessionPayload } from './devSession'

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
  const s = process.env.DEV_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) return null
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return toBase64Url(new Uint8Array(sig))
}

/** Sabit zamanlı karşılaştırma (uzunluk farkı zaten sızdırılabilir bilgi) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyDevSessionEdge(value: string | undefined | null): Promise<DevSessionPayload | null> {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const body = value.slice(0, dot)
  const sig = value.slice(dot + 1)

  const expected = await hmac(body)
  if (!expected || !safeEqual(sig, expected)) return null

  try {
    const payload = JSON.parse(fromBase64Url(body)) as Partial<DevSessionPayload>
    if (typeof payload.employeeId !== 'string' || typeof payload.createdAt !== 'number') return null
    if (Date.now() - payload.createdAt > DEV_SESSION_MAX_AGE * 1000) return null
    return { employeeId: payload.employeeId, createdAt: payload.createdAt }
  } catch {
    return null
  }
}
