// @vitest-environment node
/**
 * verifiedSession.test.ts — getClaims ile yerel oturum doğrulaması.
 *
 * Gerileme: getUser her istekte Auth sunucusuna alt istek yapıyordu (Error 1102, CPU sınırı).
 */
import { describe, it, expect, vi } from 'vitest'
import { verifySupabaseSession } from '@/lib/auth/verifiedSession'
import { SESSION_MAX_AGE } from '@/lib/auth/sessionAge'

const NOW = Date.UTC(2026, 9, 30, 12)
const DAY = 24 * 60 * 60

function authWith(claims: Record<string, unknown> | null, user: { id: string; last_sign_in_at?: string } | null = null) {
  return {
    getClaims: vi.fn(async () => (claims ? { data: { claims }, error: null } : { data: null, error: null })),
    getUser: vi.fn(async () => ({ data: { user } })),
  }
}
const amrAt = (secondsAgo: number) => [{ method: 'otp', timestamp: NOW / 1000 - secondsAgo }]

describe('verifySupabaseSession', () => {
  it('geçerli claims: kullanıcı ve oturum kimliği döner, Auth sunucusuna gidilmez', async () => {
    const auth = authWith({ sub: 'auth-1', session_id: 'sess-1', amr: amrAt(DAY) })
    expect(await verifySupabaseSession(auth, NOW)).toEqual({ userId: 'auth-1', sessionId: 'sess-1', expired: false })
    expect(auth.getUser).not.toHaveBeenCalled()
  })

  it('oturum yok / imza geçersiz → null', async () => {
    expect(await verifySupabaseSession(authWith(null), NOW)).toBeNull()
    const failing = {
      getClaims: async () => ({ data: null, error: new Error('Invalid JWT signature') }),
      getUser: vi.fn(),
    }
    expect(await verifySupabaseSession(failing, NOW)).toBeNull()
    expect(await verifySupabaseSession(authWith({ session_id: 'x', amr: amrAt(1) }), NOW)).toBeNull()
  })

  it('girişten 30 gün geçtiyse expired', async () => {
    const auth = authWith({ sub: 'auth-1', amr: amrAt(SESSION_MAX_AGE + 60) })
    expect((await verifySupabaseSession(auth, NOW))?.expired).toBe(true)
  })

  it('amr yoksa giriş anı kullanıcı kaydından okunur (yalnızca o zaman getUser)', async () => {
    const old = new Date(NOW - (SESSION_MAX_AGE + 60) * 1000).toISOString()
    const auth = authWith({ sub: 'auth-1' }, { id: 'auth-1', last_sign_in_at: old })
    expect(await verifySupabaseSession(auth, NOW)).toEqual({ userId: 'auth-1', sessionId: null, expired: true })
    expect(auth.getUser).toHaveBeenCalledTimes(1)
  })

  it('amr yokken kullanıcı bulunamaz ya da farklıysa oturum geçersiz', async () => {
    expect(await verifySupabaseSession(authWith({ sub: 'auth-1' }, null), NOW)).toBeNull()
    expect(await verifySupabaseSession(authWith({ sub: 'auth-1' }, { id: 'auth-2' }), NOW)).toBeNull()
  })
})
