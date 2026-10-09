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
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import {
  IS_DEV_AUTH,
  getDevOtp,
  DEV_SESSION_COOKIE,
  DEV_SESSION_MAX_AGE,
} from '@/lib/authConfig'

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
    const { data: employee } = await admin
      .from('employees')
      .select('id, full_name, active, email, role, role_id')
      .eq('email', email)
      .maybeSingle()

    if (!employee) {
      return NextResponse.json(
        { ok: false, reason: 'EMPLOYEE_NOT_FOUND' },
        { status: 403 }
      )
    }
    if (!employee.active) {
      return NextResponse.json(
        { ok: false, reason: 'EMPLOYEE_INACTIVE' },
        { status: 403 }
      )
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
    if (otp !== getDevOtp()) {
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
        role,
        role_id,
        active,
        auth_user_id,
        created_at,
        updated_at,
        roles (
          id,
          name,
          description,
          created_at
        )
      `)
      .eq('email', email)
      .maybeSingle()

    if (!employee || !employee.active) {
      return NextResponse.json(
        { ok: false, reason: 'EMPLOYEE_NOT_FOUND' },
        { status: 403 }
      )
    }

    // Session payload — sadece employee ID saklıyoruz (cookie'de minimal veri)
    const sessionPayload = JSON.stringify({
      employeeId: employee.id,
      email,
      createdAt: Date.now(),
    })

    const res = NextResponse.json({ ok: true, employee })

    // HttpOnly cookie — JS'ten okunamaz, CSRF'e karşı SameSite=Strict
    res.cookies.set(DEV_SESSION_COOKIE, sessionPayload, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: DEV_SESSION_MAX_AGE,
      // Development'ta HTTPS zorunlu değil; production'da secure: true olur
      secure: false,
    })

    return res
  }

  return NextResponse.json({ ok: false, reason: 'UNKNOWN_STEP' }, { status: 400 })
}
