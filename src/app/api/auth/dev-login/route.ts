/**
 * POST /api/auth/dev-login
 *
 * Development auth — Supabase Auth kullanılmaz, email gönderilmez.
 * İki aşamalı çağrı:
 *
 * Aşama 1 — email kontrolü:
 *   Body: { step: 'check-email', email: string }
 *   → employees tablosunda email aranır
 *   → 200 { ok: true }  |  403 { ok: false, reason }
 *
 * Aşama 2 — OTP doğrulama:
 *   Body: { step: 'verify-otp', email: string, otp: string }
 *   → DEV_OTP ile karşılaştırılır
 *   → Başarılıysa HttpOnly dev_auth_session cookie set edilir
 *   → 200 { ok: true, employee }  |  401 { ok: false, reason }
 *
 * ÖNEMLİ: Bu route yalnızca AUTH_MODE=development'ta aktiftir.
 * Production'da 403 döner.
 */
import { isEffectivelyActive } from '@/lib/employment'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import {
  IS_DEV_AUTH,
  getDevOtp,
  DEV_SESSION_COOKIE,
  DEV_SESSION_MAX_AGE,
} from '@/lib/authConfig'
import { signDevSession } from '@/lib/auth/devSession'
import { ADMIN_DEVICE_COOKIE } from '@/lib/auth/adminLogin'
import { ACCESS, accessLevelOf } from '@/lib/auth/roles'
import { checkRateLimit, clientIp } from '@/lib/rateLimiter'
import { timingSafeEqual } from 'crypto'

export async function POST(req: NextRequest) {
  // Production'da bu route kapalı
  if (!IS_DEV_AUTH) {
    return NextResponse.json({ ok: false, reason: 'NOT_AVAILABLE' }, { status: 403 })
  }

  let body: Record<string, string>
  try {
    body = (await req.json()) as Record<string, string>
  } catch {
    return NextResponse.json({ ok: false, reason: 'INVALID_JSON' }, { status: 400 })
  }

  const step = body.step
  const email = body.email?.trim().toLowerCase()

  if (!email || !email.includes('@')) {
    return NextResponse.json(
      { ok: false, reason: 'INVALID_EMAIL' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // ── Aşama 1: Email + aktiflik kontrolü ──────────────────────
  if (step === 'check-email') {
    // Yanıt e-postanın kayıtlı olup olmadığını söyler: tünelle açılmış dev sunucusunda
    // çalışan listesi taranmasın
    const rate = await checkRateLimit(`dev_check_email:ip:${clientIp(req)}`, 20, 15 * 60 * 1000)
    if (!rate.allowed) {
      return NextResponse.json({ ok: false, reason: 'RATE_LIMITED' }, { status: 429 })
    }

    const { data: employee } = await admin
      .from('employees')
      .select('id, full_name, active, termination_date, email, role_id, roles ( access_level )')
      .eq('email', email)
      .maybeSingle()

    if (!employee) {
      return NextResponse.json(
        { ok: false, reason: 'EMPLOYEE_NOT_FOUND' },
        { status: 403 }
      )
    }
    if (!isEffectivelyActive(employee)) {
      return NextResponse.json(
        { ok: false, reason: 'EMPLOYEE_INACTIVE' },
        { status: 403 }
      )
    }
    // Admin yalnızca admin girişinden (şifre + kod) girer — bkz. /api/auth/admin/password
    if (accessLevelOf(employee.roles) === ACCESS.ADMIN) {
      return NextResponse.json({ ok: false, reason: 'ADMIN_LOGIN_REQUIRED' }, { status: 403 })
    }

    // Başarılı — OTP adımına geç (dev modunda email gönderilmez)
    return NextResponse.json({ ok: true })
  }

  // ── Aşama 2: OTP doğrulama ──────────────────────────────────
  if (step === 'verify-otp') {
    const otp = body.otp?.trim()

    if (!otp) {
      return NextResponse.json(
        { ok: false, reason: 'MISSING_OTP' },
        { status: 400 }
      )
    }

    // Dev OTP kontrolü — yalnızca burada, tek yerde
    // Sabit DEV_OTP'ye kaba kuvvet denemesine karşı IP bazlı limit
    const [rate, byEmail] = await Promise.all([
      checkRateLimit(`dev_otp:ip:${clientIp(req)}`, 10, 15 * 60 * 1000),
      checkRateLimit(`dev_otp:email:${email}`, 10, 15 * 60 * 1000),
    ])
    if (!rate.allowed || !byEmail.allowed) {
      return NextResponse.json({ ok: false, reason: 'RATE_LIMITED' }, { status: 429 })
    }

    const expected = Buffer.from(getDevOtp())
    const given = Buffer.from(otp)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return NextResponse.json(
        { ok: false, reason: 'INVALID_OTP' },
        { status: 401 }
      )
    }

    // OTP doğru — employee'yı yükle (roles join ile)
    const { data: employee } = await admin
      .from('employees')
      .select(`
        id,
        full_name,
        email,
        role_id,
        active,
        termination_date,
        auth_user_id,
        created_at,
        updated_at,
        roles (
          id,
          name,
          description,
        access_level,
        planning_group,
        sort_order,
          created_at
        )
      `)
      .eq('email', email)
      .maybeSingle()

    if (!employee || !isEffectivelyActive(employee)) {
      return NextResponse.json(
        { ok: false, reason: 'EMPLOYEE_NOT_FOUND' },
        { status: 403 }
      )
    }
    if (accessLevelOf(employee.roles) === ACCESS.ADMIN) {
      return NextResponse.json({ ok: false, reason: 'ADMIN_LOGIN_REQUIRED' }, { status: 403 })
    }

    // İmzalı session — sadece employee ID (HMAC ile; istemci değiştiremez)
    const sessionPayload = signDevSession({ employeeId: employee.id, createdAt: Date.now() })

    const res = NextResponse.json({ ok: true, employee })

    // HttpOnly cookie — JS'ten okunamaz, CSRF'e karşı SameSite=Strict
    res.cookies.set(DEV_SESSION_COOKIE, sessionPayload, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: DEV_SESSION_MAX_AGE,
      // Tünel (https) üzerinden erişimde secure; localhost http'de false
      secure: req.nextUrl.protocol === 'https:',
    })
    // Cihaz artık bir çalışanın: sonraki /login çalışan formunu açsın (bkz. ADMIN_DEVICE_COOKIE)
    res.cookies.delete(ADMIN_DEVICE_COOKIE)

    return res
  }

  return NextResponse.json({ ok: false, reason: 'UNKNOWN_STEP' }, { status: 400 })
}
