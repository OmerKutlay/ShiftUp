/**
 * POST /api/auth/admin/verify
 *
 * Admin girişi — 2. adım: e-postaya gelen kod. Yalnızca 1. adımda (/api/auth/admin/password)
 * şifresi doğrulanmış aynı e-posta için, 10 dakika içinde kabul edilir. 1. adım hatalıysa da
 * bekleme çerezi yazılır ama rastgele bir kimliğe bağlıdır ve kod gönderilmemiştir — her kod
 * INVALID_OTP ile reddedilir. Başarılıysa oturum
 * açılır ve oturuma bağlı ADMIN_VERIFIED_COOKIE yazılır (bkz. @/lib/auth/adminLogin).
 *
 * AUTH_MODE=production  → Supabase verifyOtp
 * AUTH_MODE=development → DEV_OTP + imzalı dev_auth_session çerezi
 *
 * Body: { email: string, token: string }
 * Response:
 *   200 { ok: true }
 *   400 { ok: false, reason: 'INVALID_EMAIL' | 'INVALID_TOKEN_FORMAT' | 'INVALID_JSON' }
 *   401 { ok: false, reason: 'PASSWORD_REQUIRED' | 'INVALID_OTP' | 'OTP_EXPIRED' }
 *   403 { ok: false, reason: 'EMPLOYEE_NOT_FOUND' }
 *   429 { ok: false, reason: 'RATE_LIMITED' }
 */
import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isEffectivelyActive } from '@/lib/employment'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { DEV_SESSION_COOKIE, DEV_SESSION_MAX_AGE, IS_DEV_AUTH, getDevOtp } from '@/lib/authConfig'
import { signDevSession } from '@/lib/auth/devSession'
import { SESSION_MAX_AGE, sessionIdOf } from '@/lib/auth/sessionAge'
import {
  ADMIN_DEVICE_COOKIE, ADMIN_DEVICE_MAX_AGE, ADMIN_PENDING_COOKIE, ADMIN_VERIFIED_COOKIE, adminCookieOptions, devSessionId, readAdminToken, signAdminToken,
} from '@/lib/auth/adminLogin'
import { ACCESS, accessLevelOf } from '@/lib/auth/roles'
import { checkRateLimit, clientIp } from '@/lib/rateLimiter'
import { isValidEmail } from '@/lib/validation'

const WINDOW_MS = 15 * 60 * 1000
const PER_EMAIL_PER_IP = 10
const PER_EMAIL = 20
const PER_IP = 30

const EMPLOYEE_SELECT = 'id, email, active, termination_date, roles ( access_level )'

type EmployeeRow = { id: string; active: boolean; termination_date: string | null; roles: unknown }

/** Şifresi doğrulanan çalışan hâlâ aktif bir admin mi? */
function isActiveAdmin(employee: EmployeeRow | null, pendingId: string): employee is EmployeeRow {
  return !!employee && employee.id === pendingId && isEffectivelyActive(employee)
    && accessLevelOf(employee.roles) === ACCESS.ADMIN
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; token?: unknown }
  try {
    body = (await req.json()) as { email?: unknown; token?: unknown }
  } catch {
    return NextResponse.json({ ok: false, reason: 'INVALID_JSON' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, reason: 'INVALID_EMAIL' }, { status: 400 })
  }
  if (!(IS_DEV_AUTH ? /^\d{4,6}$/ : /^\d{6}$/).test(token)) {
    return NextResponse.json({ ok: false, reason: 'INVALID_TOKEN_FORMAT' }, { status: 400 })
  }

  // 1. adım bu tarayıcıda, bu e-posta için ve süresi içinde tamamlanmış olmalı
  const pending = await readAdminToken(req.cookies.get(ADMIN_PENDING_COOKIE)?.value, 'pending')
  if (!pending || pending.sid !== email) {
    return NextResponse.json({ ok: false, reason: 'PASSWORD_REQUIRED' }, { status: 401 })
  }

  const ip = clientIp(req)
  const limits = await Promise.all([
    checkRateLimit(`admin_otp:email_ip:${email}:${ip}`, PER_EMAIL_PER_IP, WINDOW_MS, { failClosed: true }),
    checkRateLimit(`admin_otp:email:${email}`, PER_EMAIL, WINDOW_MS, { failClosed: true }),
    checkRateLimit(`admin_otp:ip:${ip}`, PER_IP, WINDOW_MS, { failClosed: true }),
  ])
  if (limits.some((l) => !l.allowed)) {
    return NextResponse.json({ ok: false, reason: 'RATE_LIMITED' }, { status: 429 })
  }

  const secure = req.nextUrl.protocol === 'https:'
  const admin = createAdminClient()

  try {
    let sessionId: string
    const res = NextResponse.json({ ok: true })

    if (IS_DEV_AUTH) {
      const expected = Buffer.from(getDevOtp())
      const given = Buffer.from(token)
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        return NextResponse.json({ ok: false, reason: 'INVALID_OTP' }, { status: 401 })
      }
      const { data: employee } = await admin.from('employees').select(EMPLOYEE_SELECT).eq('email', email).maybeSingle()
      // Şifre adımı hatalıyken yazılan çerez buraya düşer; prod'daki gibi "kod hatalı" görünür
      if (!isActiveAdmin(employee as EmployeeRow | null, pending.sub)) {
        return NextResponse.json({ ok: false, reason: 'INVALID_OTP' }, { status: 401 })
      }
      const createdAt = Date.now()
      res.cookies.set(DEV_SESSION_COOKIE, signDevSession({ employeeId: pending.sub, createdAt }), {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: DEV_SESSION_MAX_AGE,
        secure,
      })
      sessionId = devSessionId(createdAt)
    } else {
      const { createSupabaseServerClient } = await import('@/lib/supabase/server')
      const supabase = await createSupabaseServerClient()
      const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
      if (error || !data.user) {
        const reason = error?.code === 'otp_expired' ? 'OTP_EXPIRED' : 'INVALID_OTP'
        return NextResponse.json({ ok: false, reason }, { status: 401 })
      }

      const { data: employee } = await admin
        .from('employees')
        .select(EMPLOYEE_SELECT)
        .eq('auth_user_id', data.user.id)
        .maybeSingle()
      const sid = sessionIdOf(data.session?.access_token)
      if (!isActiveAdmin(employee as EmployeeRow | null, pending.sub) || !sid) {
        await supabase.auth.signOut({ scope: 'local' })
        if (!sid) console.error('[POST /api/auth/admin/verify] access token session_id yok')
        return NextResponse.json({ ok: false, reason: 'EMPLOYEE_NOT_FOUND' }, { status: 403 })
      }
      sessionId = sid
    }

    res.cookies.set(
      ADMIN_VERIFIED_COOKIE,
      await signAdminToken('verified', pending.sub, sessionId),
      adminCookieOptions(secure, IS_DEV_AUTH ? DEV_SESSION_MAX_AGE : SESSION_MAX_AGE)
    )
    res.cookies.set(ADMIN_PENDING_COOKIE, '', adminCookieOptions(secure, 0))
    // Çıkıştan sonra da bu cihaz (PWA dahil) /login yerine admin giriş formunu açar
    res.cookies.set(ADMIN_DEVICE_COOKIE, '1', adminCookieOptions(secure, ADMIN_DEVICE_MAX_AGE))
    return res
  } catch (err) {
    console.error('[POST /api/auth/admin/verify]', err)
    return NextResponse.json({ ok: false, reason: 'UNKNOWN' }, { status: 500 })
  }
}
