/**
 * otpRateLimit.test.ts — OTP uçlarında hız sınırı kişiye özel kilitlemeye dönüşmemeli.
 *
 *   - Başka IP'den gelen yabancı, kurbanın e-postası için kendi kotasını tüketir; kurbanın
 *     kendi cihazından kod istemesi/denemesi engellenmez
 *   - IP'lerden bağımsız e-posta üst sınırı yine de geçerlidir
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const signInWithOtp = vi.hoisted(() => vi.fn())
const verifyOtp = vi.hoisted(() => vi.fn())

vi.mock('@/lib/authConfig', () => ({ IS_DEV_AUTH: false }))
vi.mock('@/lib/rateLimiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rateLimiter')>()
  // Paylaşılan sayaç yerine bellek içi sayaç (aynı sabit pencere mantığı)
  return { ...actual, checkRateLimit: async (k: string, l: number, w: number) => actual.checkRateLimitLocal(k, l, w) }
})
vi.mock('@/lib/auth/authUser', () => ({ ensureAuthUserForEmployee: async () => ({ ok: true, authUserId: 'u1' }) }))
vi.mock('@/lib/supabaseAdmin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'e1', email: 'x', active: true, auth_user_id: 'u1', termination_date: null },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithOtp, verifyOtp } }),
}))

import { POST as sendOtp } from '@/app/api/auth/send-otp/route'
import { POST as verify } from '@/app/api/auth/verify-otp/route'

function req(path: string, ip: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
  })
}

beforeEach(() => {
  signInWithOtp.mockReset().mockResolvedValue({ error: null })
  verifyOtp.mockReset().mockResolvedValue({ data: {}, error: { status: 401, message: 'invalid', code: 'otp_expired' } })
})

describe('send-otp', () => {
  it('yabancı IP kurbanın e-postası için kotasını doldursa da kurban kendi IP\'sinden kod alabilir', async () => {
    const email = 'kurban-send@test.com'
    for (let i = 0; i < 5; i++) {
      expect((await sendOtp(req('/api/auth/send-otp', '198.51.100.66', { email }))).status).toBe(200)
    }
    expect((await sendOtp(req('/api/auth/send-otp', '198.51.100.66', { email }))).status).toBe(429)
    expect((await sendOtp(req('/api/auth/send-otp', '203.0.113.10', { email }))).status).toBe(200)
  })

  it('IP\'lerden bağımsız e-posta üst sınırı aşılınca reddedilir', async () => {
    const email = 'tasma-send@test.com'
    const statuses: number[] = []
    for (let i = 0; i < 16; i++) {
      statuses.push((await sendOtp(req('/api/auth/send-otp', `198.51.100.${i}`, { email }))).status)
    }
    expect(statuses.slice(0, 15).every((s) => s === 200)).toBe(true)
    expect(statuses[15]).toBe(429)
    expect(signInWithOtp).toHaveBeenCalledTimes(15)
  })
})

describe('verify-otp', () => {
  it('yabancı IP\'den yanlış kod denemeleri kurbanın kendi denemesini kilitlemez', async () => {
    const email = 'kurban-verify@test.com'
    for (let i = 0; i < 10; i++) {
      await verify(req('/api/auth/verify-otp', '198.51.100.77', { email, token: '000000' }))
    }
    expect((await verify(req('/api/auth/verify-otp', '198.51.100.77', { email, token: '000000' }))).status).toBe(429)
    const own = await verify(req('/api/auth/verify-otp', '203.0.113.20', { email, token: '123456' }))
    expect(own.status).not.toBe(429)
  })
})
