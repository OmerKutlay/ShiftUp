/**
 * POST /api/auth/verify-otp
 *
 * Production auth — email'e gönderilen 6 haneli kodu doğrular.
 * Başarılıysa Supabase Auth session cookie'leri response'a yazılır.
 *
 * Kaba kuvvet önlemi: e-posta başına ve IP başına deneme sınırı (paylaşılan sayaç).
 * Admin hesabı burada oturum açamaz (oturum kapatılır, INVALID_OTP): admin girişi şifre ister —
 * bkz. /api/auth/admin/verify.
 *
 * Body: { email: string, token: string }
 * Response:
 *   200 { ok: true }
 *   400 { ok: false, reason: 'INVALID_EMAIL' | 'INVALID_TOKEN_FORMAT' }
 *   401 { ok: false, reason: 'INVALID_OTP' | 'OTP_EXPIRED' }
 *   403 { ok: false, reason: 'EMPLOYEE_NOT_FOUND' | 'NOT_AVAILABLE' }
 *   429 { ok: false, reason: 'RATE_LIMITED' }
 *
 * ÖNEMLİ: Bu route yalnızca AUTH_MODE=production'da aktiftir.
 */
import { isEffectivelyActive } from '@/lib/employment'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { IS_DEV_AUTH } from '@/lib/authConfig'
import { ACCESS, accessLevelOf } from '@/lib/auth/roles'
import { checkRateLimit, clientIp } from '@/lib/rateLimiter'
import { isValidEmail } from '@/lib/validation'

const WINDOW_MS = 15 * 60 * 1000
/**
 * Deneme sınırı e-posta+IP için dar, e-posta için (IP'lerden bağımsız) daha geniştir: yabancı
 * bir IP'den yanlış kod denemek kurbanın kendi cihazındaki denemelerini kilitlemez; 6 haneli
 * kod için pencere başına toplam deneme yine PER_EMAIL ile sınırlıdır.
 */
const PER_EMAIL_PER_IP = 10
const PER_EMAIL = 20
const PER_IP = 30

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

  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, reason: 'INVALID_EMAIL' }, { status: 400 })
  }
  if (!token || !/^\d{6}$/.test(token)) {
    return NextResponse.json({ ok: false, reason: 'INVALID_TOKEN_FORMAT' }, { status: 400 })
  }

  const ip = clientIp(req)
  const limits = await Promise.all([
    checkRateLimit(`otp_verify:email_ip:${email}:${ip}`, PER_EMAIL_PER_IP, WINDOW_MS, { failClosed: true }),
    checkRateLimit(`otp_verify:email:${email}`, PER_EMAIL, WINDOW_MS, { failClosed: true }),
    checkRateLimit(`otp_verify:ip:${ip}`, PER_IP, WINDOW_MS, { failClosed: true }),
  ])
  if (limits.some((l) => !l.allowed)) {
    return NextResponse.json({ ok: false, reason: 'RATE_LIMITED' }, { status: 429 })
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
      .select('id, active, termination_date, roles ( access_level )')
      .eq('auth_user_id', data.user.id)
      .maybeSingle()

    if (!employee || !isEffectivelyActive(employee)) {
      await supabase.auth.signOut()
      return NextResponse.json({ ok: false, reason: 'EMPLOYEE_NOT_FOUND' }, { status: 403 })
    }
    // Admin bu akışla giremez; yanıt kod hatasından ayırt edilmez (admin hesabını ele vermez).
    // scope 'local': yalnızca bu oturum kapanır, adminin diğer cihazlardaki oturumları kalır.
    if (accessLevelOf(employee.roles) === ACCESS.ADMIN) {
      await supabase.auth.signOut({ scope: 'local' })
      return NextResponse.json({ ok: false, reason: 'INVALID_OTP' }, { status: 401 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/auth/verify-otp]', err)
    return NextResponse.json({ ok: false, reason: 'UNKNOWN' }, { status: 500 })
  }
}
