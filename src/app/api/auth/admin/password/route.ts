/**
 * POST /api/auth/admin/password
 *
 * Admin girişi — 1. adım: e-posta + admin şifresi. Şifre doğruysa e-postaya giriş kodu gönderilir
 * (dev modunda gönderilmez, DEV_OTP kullanılır) ve 10 dakikalık imzalı "şifre doğrulandı" çerezi
 * yazılır; 2. adım (/api/auth/admin/verify) bu çerez olmadan kodu kabul etmez.
 *
 * Body: { email: string, password: string }
 *
 * Hesap yok / pasif / admin değil / şifresi yok / şifre yanlış → başarılı gibi yanıtlanır:
 * kod gönderilmez ama rastgele kimlikli bir bekleme çerezi yine yazılır, istemci kod adımına geçer
 * ve girilen her kod reddedilir. Böylece deneme yanılmayla hangi e-postanın admin olduğu (ya da
 * şifrenin doğru olduğu) anlaşılamaz. Şifre karşılaştırması her durumda yapılır (sabit süre).
 *
 * Response:
 *   200 { ok: true }
 *   400 { ok: false, reason: 'INVALID_EMAIL' | 'INVALID_JSON' }
 *   429 { ok: false, reason: 'RATE_LIMITED' }
 *   500 { ok: false, reason: 'SEND_FAILED' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { isEffectivelyActive } from '@/lib/employment'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { IS_DEV_AUTH } from '@/lib/authConfig'
import { ensureAuthUserForEmployee } from '@/lib/auth/authUser'
import { verifyAdminPassword } from '@/lib/auth/adminPassword'
import {
  ADMIN_PENDING_COOKIE, ADMIN_PENDING_MAX_AGE, adminCookieOptions, signAdminToken,
} from '@/lib/auth/adminLogin'
import { ACCESS, accessLevelOf } from '@/lib/auth/roles'
import { checkRateLimit, clientIp } from '@/lib/rateLimiter'
import { isValidEmail } from '@/lib/validation'

const WINDOW_MS = 15 * 60 * 1000
/**
 * Şifre denemesi sınırları: e-posta+IP dar (yabancı bir IP kurbanın kendi cihazını kilitleyemez),
 * e-posta için IP'lerden bağımsız toplam üst sınır (dağıtık kaba kuvvete karşı).
 */
const PER_EMAIL_PER_IP = 5
const PER_EMAIL = 20
const PER_IP = 20

/**
 * Kod gönderildi + bekleme çerezi yazıldı yanıtı. Bilgiler hatalıysa çerez rastgele bir kimliğe
 * bağlanır (çerez içeriği okunabilir; gerçek kimlik gibi görünmeli) — 2. adımda hiçbir kod geçmez.
 */
async function codeStepResponse(req: NextRequest, employeeId: string, email: string) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(
    ADMIN_PENDING_COOKIE,
    await signAdminToken('pending', employeeId, email),
    adminCookieOptions(req.nextUrl.protocol === 'https:', ADMIN_PENDING_MAX_AGE)
  )
  return res
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown }
  try {
    body = (await req.json()) as { email?: unknown; password?: unknown }
  } catch {
    return NextResponse.json({ ok: false, reason: 'INVALID_JSON' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : undefined
  if (!isValidEmail(email)) {
    return NextResponse.json({ ok: false, reason: 'INVALID_EMAIL' }, { status: 400 })
  }
  const password = typeof body.password === 'string' ? body.password : ''

  const ip = clientIp(req)
  const limits = await Promise.all([
    checkRateLimit(`admin_pw:email_ip:${email}:${ip}`, PER_EMAIL_PER_IP, WINDOW_MS, { failClosed: true }),
    checkRateLimit(`admin_pw:email:${email}`, PER_EMAIL, WINDOW_MS, { failClosed: true }),
    checkRateLimit(`admin_pw:ip:${ip}`, PER_IP, WINDOW_MS, { failClosed: true }),
  ])
  if (limits.some((l) => !l.allowed)) {
    return NextResponse.json({ ok: false, reason: 'RATE_LIMITED' }, { status: 429 })
  }

  try {
    const admin = createAdminClient()
    const { data: employee, error: empErr } = await admin
      .from('employees')
      .select('id, email, active, auth_user_id, termination_date, roles ( access_level )')
      .eq('email', email)
      .maybeSingle()
    if (empErr) throw empErr

    const isAdmin = !!employee && isEffectivelyActive(employee) && accessLevelOf(employee.roles) === ACCESS.ADMIN
    // Admin olmayan hesapta da karşılaştırma yapılır (NO_EMPLOYEE_ID) — süre farkı hesabı ele vermez
    const passwordOk = !!password && await verifyAdminPassword(admin, isAdmin ? employee.id : null, password)
    if (!isAdmin || !passwordOk) return codeStepResponse(req, crypto.randomUUID(), email)

    if (!IS_DEV_AUTH) {
      const provision = await ensureAuthUserForEmployee(admin, {
        id: employee.id,
        email,
        auth_user_id: employee.auth_user_id,
      })
      if (!provision.ok) {
        console.error('[POST /api/auth/admin/password] auth provisioning:', provision.reason)
        return NextResponse.json({ ok: false, reason: 'SEND_FAILED' }, { status: 500 })
      }

      const { createSupabaseServerClient } = await import('@/lib/supabase/server')
      const supabase = await createSupabaseServerClient()
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
      if (error) {
        if (error.status === 429) {
          return NextResponse.json({ ok: false, reason: 'RATE_LIMITED' }, { status: 429 })
        }
        console.error('[POST /api/auth/admin/password] signInWithOtp:', error.message)
        return NextResponse.json({ ok: false, reason: 'SEND_FAILED' }, { status: 500 })
      }
    }

    return codeStepResponse(req, employee.id, email)
  } catch (err) {
    console.error('[POST /api/auth/admin/password]', err)
    return NextResponse.json({ ok: false, reason: 'SEND_FAILED' }, { status: 500 })
  }
}
