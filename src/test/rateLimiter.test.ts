/**
 * rateLimiter.test.ts — paylaşılan sayaç (rate_limit_hit) hata verdiğinde davranış.
 * Varsayılan: bellek içi sayaca düşer. failClosed (OTP uçları): istek reddedilir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => ({ rpc }) }))

import { checkRateLimit } from '@/lib/rateLimiter'

beforeEach(() => {
  rpc.mockReset()
})

describe('checkRateLimit', () => {
  it('paylaşılan sayacın sonucunu döner', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, remaining: 0, reset_at: '2099-01-01T00:00:00Z' }], error: null })
    await expect(checkRateLimit('k1', 5, 60_000)).resolves.toMatchObject({ allowed: false })
  })

  it('sayaç hata verirse varsayılan olarak bellek içi sayaca düşer', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    await expect(checkRateLimit('k2', 5, 60_000)).resolves.toMatchObject({ allowed: true })
  })

  it('failClosed: sayaç okunamazsa istek reddedilir', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    await expect(checkRateLimit('otp_verify:email:a@b.c', 5, 60_000, { failClosed: true })).resolves.toMatchObject({ allowed: false })
    rpc.mockRejectedValue(new Error('network'))
    await expect(checkRateLimit('otp_verify:email:a@b.c', 5, 60_000, { failClosed: true })).resolves.toMatchObject({ allowed: false })
  })
})
