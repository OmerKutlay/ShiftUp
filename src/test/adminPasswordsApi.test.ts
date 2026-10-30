// @vitest-environment node
/**
 * adminPasswordsApi.test.ts — POST /api/admin-passwords
 *
 *   - Başka bir adminin şifresi doğrudan belirlenir; denetim kaydına şifre yazılmaz
 *   - Kendi şifresini değiştiren admin mevcut şifresini doğru girmeli
 *   - Yalnızca aktif admin hesabına şifre atanır; kısa şifre reddedilir
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const rpc = vi.hoisted(() => vi.fn())
const logAudit = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => ({ target: null as Record<string, unknown> | null }))

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  requireMinRole: async () => ({ employee: { id: 'me', access_level: 'admin' } }),
}))
vi.mock('@/lib/rateLimiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rateLimiter')>()
  return { ...actual, checkRateLimit: async (k: string, l: number, w: number) => actual.checkRateLimitLocal(k, l, w) }
})
vi.mock('@/lib/auditLog', () => ({ logAudit }))
vi.mock('@/lib/supabaseAdmin', () => ({
  createAdminClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: db.target, error: null }) }
      return q
    },
    rpc: async (name: string, args: unknown) => ({ data: rpc(name, args), error: null }),
  }),
}))

import { POST } from '@/app/api/admin-passwords/route'

const adminRow = (id: string) => ({ id, active: true, termination_date: null, roles: { access_level: 'admin' } })
function post(body: unknown) {
  return POST(new NextRequest('https://shiftup.test/api/admin-passwords', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockImplementation((name: string, a: { p_password: string }) =>
    name === 'verify_admin_password' ? a.p_password === 'eski-sifre-123' : null)
})

describe('POST /api/admin-passwords', () => {
  it('başka bir adminin şifresi belirlenir; denetim kaydında şifre yok', async () => {
    db.target = adminRow('other')
    const res = await post({ employee_id: 'other', password: 'yeni-sifre-123' })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('set_admin_password', { p_employee_id: 'other', p_password: 'yeni-sifre-123', p_actor_id: 'me' })
    expect(JSON.stringify(logAudit.mock.calls)).not.toContain('yeni-sifre-123')
  })

  it('kendi şifresi: mevcut şifre yanlışsa değiştirilmez', async () => {
    db.target = adminRow('me')
    const bad = await post({ employee_id: 'me', password: 'yeni-sifre-123', current_password: 'yanlis' })
    expect(bad.status).toBe(400)
    expect(rpc).not.toHaveBeenCalledWith('set_admin_password', expect.anything())

    const ok = await post({ employee_id: 'me', password: 'yeni-sifre-123', current_password: 'eski-sifre-123' })
    expect(ok.status).toBe(200)
  })

  it('admin olmayan hesaba şifre atanmaz; kısa şifre reddedilir', async () => {
    db.target = { ...adminRow('emp'), roles: { access_level: 'manager' } }
    expect((await post({ employee_id: 'emp', password: 'yeni-sifre-123' })).status).toBe(404)
    db.target = adminRow('other')
    expect((await post({ employee_id: 'other', password: 'kisa' })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalledWith('set_admin_password', expect.anything())
  })
})
