/**
 * sessionAge.test.ts — Supabase oturumunun mutlak ömrü (girişten 30 gün).
 */
import { describe, it, expect } from 'vitest'
import { isSessionExpired, sessionStartedAt, SESSION_MAX_AGE } from '@/lib/auth/sessionAge'

const NOW = Date.UTC(2026, 9, 24)
const jwt = (payload: unknown) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`

describe('sessionAge', () => {
  it('giriş anı amr claim\'inden okunur (en eski kayıt)', () => {
    const token = jwt({ amr: [{ method: 'otp', timestamp: 2000 }, { method: 'totp', timestamp: 1000 }] })
    expect(sessionStartedAt(token, '2026-01-01T00:00:00Z')).toBe(1000 * 1000)
  })

  it('amr yoksa / token bozuksa last_sign_in_at kullanılır', () => {
    expect(sessionStartedAt(jwt({ sub: 'x' }), '2026-10-01T00:00:00Z')).toBe(Date.parse('2026-10-01T00:00:00Z'))
    expect(sessionStartedAt('bozuk', '2026-10-01T00:00:00Z')).toBe(Date.parse('2026-10-01T00:00:00Z'))
  })

  it('30 gün sınırı', () => {
    const at = (ageSec: number) => jwt({ amr: [{ method: 'otp', timestamp: NOW / 1000 - ageSec }] })
    expect(isSessionExpired(at(SESSION_MAX_AGE - 60), null, NOW)).toBe(false)
    expect(isSessionExpired(at(SESSION_MAX_AGE + 60), null, NOW)).toBe(true)
  })

  it('giriş anı belirlenemezse oturum düşürülmez', () => {
    expect(isSessionExpired(null, null, NOW)).toBe(false)
  })
})
