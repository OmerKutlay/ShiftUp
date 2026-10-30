// @vitest-environment node
/**
 * adminLogin.test.ts — Admin girişi: admin şifresi → e-posta kodu → oturuma bağlı çerez.
 *
 *   - İmzalı çerez: değiştirilmiş / türü yanlış / süresi dolmuş / başka oturuma ait çerez geçmez
 *   - /api/auth/admin/password: yanlış şifre ya da admin olmayan hesap → aynı yanıt, kod gönderilmez
 *   - /api/auth/admin/verify: şifre adımı (bu e-posta için) olmadan kod kabul edilmez
 *   - Normal giriş (send-otp / verify-otp) admin hesabına oturum açmaz
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

process.env.SUPABASE_SECRET_KEY = 'test-secret-key'

const signInWithOtp = vi.hoisted(() => vi.fn())
const verifyOtp = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const verifyPasswordRpc = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => ({ employee: null as Record<string, unknown> | null }))

vi.mock('@/lib/authConfig', () => ({
  IS_DEV_AUTH: false,
  DEV_SESSION_COOKIE: 'dev_auth_session',
  DEV_SESSION_MAX_AGE: 8 * 60 * 60,
  getDevOtp: () => '12345',
}))
vi.mock('@/lib/rateLimiter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rateLimiter')>()
  return { ...actual, checkRateLimit: async (k: string, l: number, w: number) => actual.checkRateLimitLocal(k, l, w) }
})
vi.mock('@/lib/auth/authUser', () => ({ ensureAuthUserForEmployee: async () => ({ ok: true, authUserId: 'u1' }) }))
vi.mock('@/lib/supabaseAdmin', () => ({
  createAdminClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: db.employee, error: null }) }
      return q
    },
    rpc: async (name: string, args: { p_employee_id: string; p_password: string }) =>
      name === 'verify_admin_password' ? { data: verifyPasswordRpc(args), error: null } : { data: null, error: null },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithOtp, verifyOtp, signOut } }),
}))

import {
  ADMIN_PENDING_COOKIE, ADMIN_VERIFIED_COOKIE, passesAdminLogin, readAdminToken, signAdminToken,
} from '@/lib/auth/adminLogin'
import { POST as adminPassword } from '@/app/api/auth/admin/password/route'
import { POST as adminVerify } from '@/app/api/auth/admin/verify/route'
import { POST as sendOtp } from '@/app/api/auth/send-otp/route'
import { POST as verifyOtpRoute } from '@/app/api/auth/verify-otp/route'

const ADMIN = { id: 'e-admin', email: 'admin@test.com', active: true, auth_user_id: 'u1', termination_date: null, roles: { access_level: 'admin' } }
const EMPLOYEE = { ...ADMIN, id: 'e-emp', email: 'calisan@test.com', roles: { access_level: 'employee' } }
const accessToken = (sessionId: string) => `h.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.s`

let ipSeq = 0
function req(path: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${++ipSeq % 250}` }
  if (cookie) headers.cookie = cookie
  return new NextRequest(`https://shiftup.test${path}`, { method: 'POST', body: JSON.stringify(body), headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.employee = ADMIN
  signInWithOtp.mockResolvedValue({ error: null })
  signOut.mockResolvedValue({ error: null })
  verifyPasswordRpc.mockImplementation((a: { p_employee_id: string; p_password: string }) =>
    a.p_employee_id === ADMIN.id && a.p_password === 'dogru-sifre-123')
  verifyOtp.mockResolvedValue({ data: { user: { id: 'u1' }, session: { access_token: accessToken('sess-1') } }, error: null })
})

describe('admin çerezi', () => {
  it('geçerli çerez yalnızca kendi çalışanı ve oturumu için geçer', async () => {
    const token = await signAdminToken('verified', 'e1', 'sess-1')
    expect(await passesAdminLogin('admin', token, 'e1', 'sess-1')).toBe(true)
    expect(await passesAdminLogin('admin', token, 'e2', 'sess-1')).toBe(false)
    expect(await passesAdminLogin('admin', token, 'e1', 'sess-2')).toBe(false)
    expect(await passesAdminLogin('admin', undefined, 'e1', 'sess-1')).toBe(false)
    expect(await passesAdminLogin('admin', token, 'e1', null)).toBe(false)
  })

  it('admin olmayan hesap çerez gerektirmez', async () => {
    expect(await passesAdminLogin('manager', undefined, 'e1', null)).toBe(true)
    expect(await passesAdminLogin(null, undefined, 'e1', null)).toBe(true)
  })

  it('değiştirilmiş, türü yanlış ya da süresi dolmuş çerez reddedilir', async () => {
    const token = await signAdminToken('verified', 'e1', 'sess-1')
    const [body, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ k: 'verified', sub: 'e2', sid: 'sess-1', iat: Date.now() })).toString('base64url')
    expect(await readAdminToken(`${forged}.${sig}`, 'verified')).toBeNull()
    expect(await readAdminToken(`${body}.x${sig.slice(1)}`, 'verified')).toBeNull()

    const pending = await signAdminToken('pending', 'e1', 'a@test.com')
    expect(await readAdminToken(pending, 'verified')).toBeNull()
    expect(await readAdminToken(pending, 'pending', Date.now() + 11 * 60 * 1000)).toBeNull()
    expect(await readAdminToken(pending, 'pending')).toEqual({ sub: 'e1', sid: 'a@test.com' })
  })
})

describe('POST /api/auth/admin/password', () => {
  it('yanlış şifre: 401, kod gönderilmez, çerez yazılmaz', async () => {
    const res = await adminPassword(req('/api/auth/admin/password', { email: ADMIN.email, password: 'yanlis-sifre-1' }))
    expect(res.status).toBe(401)
    expect((await res.json()).reason).toBe('INVALID_CREDENTIALS')
    expect(signInWithOtp).not.toHaveBeenCalled()
    expect(res.cookies.get(ADMIN_PENDING_COOKIE)).toBeUndefined()
  })

  it('admin olmayan hesap aynı yanıtı alır; şifre karşılaştırması yine yapılır (sabit süre)', async () => {
    db.employee = EMPLOYEE
    const res = await adminPassword(req('/api/auth/admin/password', { email: EMPLOYEE.email, password: 'dogru-sifre-123' }))
    expect(res.status).toBe(401)
    expect((await res.json()).reason).toBe('INVALID_CREDENTIALS')
    expect(verifyPasswordRpc).toHaveBeenCalledOnce()
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  it('doğru şifre: kod gönderilir, bu e-postaya bağlı bekleme çerezi yazılır', async () => {
    const res = await adminPassword(req('/api/auth/admin/password', { email: ADMIN.email, password: 'dogru-sifre-123' }))
    expect(res.status).toBe(200)
    expect(signInWithOtp).toHaveBeenCalledWith({ email: ADMIN.email, options: { shouldCreateUser: false } })
    const pending = await readAdminToken(res.cookies.get(ADMIN_PENDING_COOKIE)?.value, 'pending')
    expect(pending).toEqual({ sub: ADMIN.id, sid: ADMIN.email })
  })

  it('aynı e-posta+IP için 5 denemeden sonra 429', async () => {
    const make = () => new NextRequest('https://shiftup.test/api/auth/admin/password', {
      method: 'POST',
      body: JSON.stringify({ email: 'kaba-kuvvet@test.com', password: 'yanlis-sifre-1' }),
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.99' },
    })
    for (let i = 0; i < 5; i++) expect((await adminPassword(make())).status).toBe(401)
    expect((await adminPassword(make())).status).toBe(429)
  })
})

describe('POST /api/auth/admin/verify', () => {
  it('şifre adımı yapılmadan kod kabul edilmez', async () => {
    const res = await adminVerify(req('/api/auth/admin/verify', { email: ADMIN.email, token: '123456' }))
    expect(res.status).toBe(401)
    expect((await res.json()).reason).toBe('PASSWORD_REQUIRED')
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('başka bir e-posta için alınmış bekleme çerezi geçmez', async () => {
    const pending = await signAdminToken('pending', 'e-other', 'baska@test.com')
    const res = await adminVerify(req('/api/auth/admin/verify', { email: ADMIN.email, token: '123456' }, `${ADMIN_PENDING_COOKIE}=${pending}`))
    expect(res.status).toBe(401)
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('şifre + kod: oturuma bağlı admin çerezi yazılır, bekleme çerezi silinir', async () => {
    const pending = await signAdminToken('pending', ADMIN.id, ADMIN.email)
    const res = await adminVerify(req('/api/auth/admin/verify', { email: ADMIN.email, token: '123456' }, `${ADMIN_PENDING_COOKIE}=${pending}`))
    expect(res.status).toBe(200)
    const verified = res.cookies.get(ADMIN_VERIFIED_COOKIE)?.value
    expect(await passesAdminLogin('admin', verified, ADMIN.id, 'sess-1')).toBe(true)
    expect(await passesAdminLogin('admin', verified, ADMIN.id, 'sess-2')).toBe(false)
    expect(res.cookies.get(ADMIN_PENDING_COOKIE)?.value).toBe('')
  })

  it('kod doğru ama hesap artık admin değil: oturum kapatılır, çerez yazılmaz', async () => {
    db.employee = { ...EMPLOYEE, id: ADMIN.id }
    const pending = await signAdminToken('pending', ADMIN.id, ADMIN.email)
    const res = await adminVerify(req('/api/auth/admin/verify', { email: ADMIN.email, token: '123456' }, `${ADMIN_PENDING_COOKIE}=${pending}`))
    expect(res.status).toBe(403)
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(res.cookies.get(ADMIN_VERIFIED_COOKIE)).toBeUndefined()
  })
})

describe('normal giriş admin hesabına oturum açmaz', () => {
  it('send-otp: admin e-postası kayıtsız gibi yanıtlanır, kod gönderilmez', async () => {
    const res = await sendOtp(req('/api/auth/send-otp', { email: ADMIN.email }))
    expect(res.status).toBe(200)
    expect(signInWithOtp).not.toHaveBeenCalled()

    db.employee = EMPLOYEE
    await sendOtp(req('/api/auth/send-otp', { email: EMPLOYEE.email }))
    expect(signInWithOtp).toHaveBeenCalledOnce()
  })

  it('verify-otp: admin koduyla oturum açılmaz, yalnızca bu oturum kapatılır', async () => {
    const res = await verifyOtpRoute(req('/api/auth/verify-otp', { email: ADMIN.email, token: '123456' }))
    expect(res.status).toBe(401)
    expect((await res.json()).reason).toBe('INVALID_OTP')
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})
