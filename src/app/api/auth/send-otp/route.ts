/**
 * POST /api/auth/send-otp
 *
 * Production auth — Supabase Auth email OTP (6 haneli kod) gönderir.
 *
 * Body: { email: string }
 * Akış:
 *   1. Rate limit: e-posta başına ve istemci IP'si başına (paylaşılan sayaç)
 *   2. Email employees tablosunda aranır, aktiflik kontrol edilir
 *   3. Employee'nın Supabase Auth kullanıcısı yoksa oluşturulup bağlanır
 *   4. signInWithOtp({ shouldCreateUser: false }) ile kod email'e gönderilir
 *
 * Kullanıcı numaralandırma önlemi: kayıtlı olmayan / pasif e-posta için de
 * { ok: true } döner (kod gönderilmez). Yanıt, adresin kayıtlı olup olmadığını ele vermez.
 *
 * Response:
 *   200 { ok: true }
 *   400 { ok: false, reason: 'INVALID_EMAIL' | 'INVALID_JSON' }
 *   403 { ok: false, reason: 'NOT_AVAILABLE' }
 *   429 { ok: false, reason: 'RATE_LIMITED' }
 *   500 { ok: false, reason: 'SEND_FAILED' }
 *
 * ÖNEMLİ: Bu route yalnızca AUTH_MODE=production'da aktiftir.
 */
import { isEffectivelyActive } from '@/lib/employment'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { IS_DEV_AUTH } from '@/lib/authConfig'
import { ensureAuthUserForEmployee } from '@/lib/auth/authUser'
import { checkRateLimit, clientIp } from '@/lib/rateLimiter'
import { isValidEmail } from '@/lib/validation'

const WINDOW_MS = 15 * 60 * 1000
const PER_EMAIL = 5
const PER_IP = 20

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

  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, reason: 'INVALID_EMAIL' }, { status: 400 })
  }

  const [byEmail, byIp] = await Promise.all([
    checkRateLimit(`otp_send:email:${email}`, PER_EMAIL, WINDOW_MS, { failClosed: true }),
    checkRateLimit(`otp_send:ip:${clientIp(req)}`, PER_IP, WINDOW_MS, { failClosed: true }),
  ])
  if (!byEmail.allowed || !byIp.allowed) {
    return NextResponse.json({ ok: false, reason: 'RATE_LIMITED' }, { status: 429 })
  }

  try {
    const admin = createAdminClient()

    const { data: employee, error: empErr } = await admin
      .from('employees')
      .select('id, email, active, auth_user_id, termination_date')
      .eq('email', email)
      .maybeSingle()
    if (empErr) throw empErr

    // Kayıtlı değil / pasif → sessizce başarı (numaralandırma önlemi)
    if (!employee || !isEffectivelyActive(employee)) {
      return NextResponse.json({ ok: true })
    }

    const provision = await ensureAuthUserForEmployee(admin, {
      id: employee.id,
      email,
      auth_user_id: employee.auth_user_id,
    })
    if (!provision.ok) {
      console.error('[POST /api/auth/send-otp] auth provisioning:', provision.reason)
      return NextResponse.json({ ok: false, reason: 'SEND_FAILED' }, { status: 500 })
    }

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
