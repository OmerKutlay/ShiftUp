/**
 * POST /api/auth/verify-otp
 *
 * Production auth — email'e gönderilen 6 haneli kodu doğrular.
 * Başarılıysa Supabase Auth session cookie'leri response'a yazılır.
 *
 * Body: { email: string, token: string }
 * Response:
 *   200 { ok: true }
 *   400 { ok: false, reason: 'INVALID_EMAIL' | 'INVALID_TOKEN_FORMAT' }
 *   401 { ok: false, reason: 'INVALID_OTP' | 'OTP_EXPIRED' }
 *   403 { ok: false, reason: 'EMPLOYEE_NOT_FOUND' | 'NOT_AVAILABLE' }
 *
 * ÖNEMLİ: Bu route yalnızca AUTH_MODE=production'da aktiftir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { IS_DEV_AUTH } from '@/lib/authConfig'

export async function POST(req: NextRequest) {
  if (IS_DEV_AUTH) {
    return NextResponse.json({ ok: false, reason: 'NOT_AVAILABLE' }, { status: 403 })
  }

  let body: { email?: string; token?: string }
  try {
    body = (await req.json()) as { email?: string; token?: string }
  } catch {
    return NextResponse.json({ ok: false, reason: 'INVALID_JSON' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const token = body.token?.trim()

  if (!email || !email.includes('@')) {
    return NextResponse.json({ ok: false, reason: 'INVALID_EMAIL' }, { status: 400 })
  }
  if (!token || !/^\d{6}$/.test(token)) {
    return NextResponse.json({ ok: false, reason: 'INVALID_TOKEN_FORMAT' }, { status: 400 })
  }

  try {
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient()

    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })

    if (error || !data.user) {
      const reason = error?.code === 'otp_expired' ? 'OTP_EXPIRED' : 'INVALID_OTP'
      return NextResponse.json({ ok: false, reason }, { status: 401 })
    }

    // Auth başarılı — kullanıcı aktif bir employee'a bağlı olmalı
    const admin = createAdminClient()
    const { data: employee } = await admin
      .from('employees')
      .select('id, active')
      .eq('auth_user_id', data.user.id)
      .maybeSingle()

    if (!employee || !employee.active) {
      await supabase.auth.signOut()
      return NextResponse.json({ ok: false, reason: 'EMPLOYEE_NOT_FOUND' }, { status: 403 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/auth/verify-otp]', err)
    return NextResponse.json({ ok: false, reason: 'UNKNOWN' }, { status: 500 })
  }
}
