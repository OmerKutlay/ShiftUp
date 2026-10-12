/**
 * POST /api/auth/send-otp
 *
 * Production auth — Supabase Auth email OTP (6 haneli kod) gönderir.
 *
 * Body: { email: string }
 * Akış:
 *   1. Email employees tablosunda aranır, aktiflik kontrol edilir
 *   2. Employee'nın Supabase Auth kullanıcısı yoksa oluşturulup bağlanır
 *   3. signInWithOtp({ shouldCreateUser: false }) ile kod email'e gönderilir
 *
 * Response:
 *   200 { ok: true }
 *   400 { ok: false, reason: 'INVALID_EMAIL' }
 *   403 { ok: false, reason: 'EMPLOYEE_NOT_FOUND' | 'EMPLOYEE_INACTIVE' | 'NOT_AVAILABLE' }
 *   429 { ok: false, reason: 'RATE_LIMITED' }
 *   500 { ok: false, reason: 'SEND_FAILED' | 'AUTH_PROVISION_FAILED' | 'AUTH_USER_CONFLICT' }
 *
 * ÖNEMLİ: Bu route yalnızca AUTH_MODE=production'da aktiftir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { IS_DEV_AUTH } from '@/lib/authConfig'
import { ensureAuthUserForEmployee } from '@/lib/auth/authUser'

export async function POST(req: NextRequest) {
  if (IS_DEV_AUTH) {
    return NextResponse.json({ ok: false, reason: 'NOT_AVAILABLE' }, { status: 403 })
  }

  let email: string | undefined
  try {
    const body = (await req.json()) as { email?: string }
    email = body.email?.trim().toLowerCase()
  } catch {
    return NextResponse.json({ ok: false, reason: 'INVALID_JSON' }, { status: 400 })
  }

  if (!email || !email.includes('@')) {
    return NextResponse.json({ ok: false, reason: 'INVALID_EMAIL' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()

    // ── 1. Employee + aktiflik kontrolü ─────────────────────────
    const { data: employee } = await admin
      .from('employees')
      .select('id, email, active, auth_user_id')
      .eq('email', email)
      .maybeSingle()

    if (!employee) {
      return NextResponse.json({ ok: false, reason: 'EMPLOYEE_NOT_FOUND' }, { status: 403 })
    }
    if (!employee.active) {
      return NextResponse.json({ ok: false, reason: 'EMPLOYEE_INACTIVE' }, { status: 403 })
    }

    // ── 2. Auth kullanıcısını hazırla ───────────────────────────
    const provision = await ensureAuthUserForEmployee(admin, {
      id: employee.id,
      email,
      auth_user_id: employee.auth_user_id,
    })
    if (!provision.ok) {
      return NextResponse.json({ ok: false, reason: provision.reason }, { status: 500 })
    }

    // ── 3. OTP gönder ───────────────────────────────────────────
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })

    if (error) {
      if (error.status === 429) {
        return NextResponse.json({ ok: false, reason: 'RATE_LIMITED' }, { status: 429 })
      }
      console.error('[POST /api/auth/send-otp] signInWithOtp:', error.message)
      return NextResponse.json({ ok: false, reason: 'SEND_FAILED' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/auth/send-otp]', err)
    return NextResponse.json({ ok: false, reason: 'SEND_FAILED' }, { status: 500 })
  }
}
