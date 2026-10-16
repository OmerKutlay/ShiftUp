/**
 * POST   /api/push/subscription — Bu cihazın push aboneliğini kaydet
 *        Body: PushSubscription.toJSON() → { endpoint, keys: { p256dh, auth } }
 * DELETE /api/push/subscription — Bu cihazın aboneliğini kaldır
 *        Body: { endpoint }
 *
 * employee_id SESSION'dan alınır. Kiosk hesabı abone olamaz (requireAuth varsayılanı).
 * Aynı endpoint başka çalışana kayıtlıysa (cihaz el değiştirdi) yeni çalışana devredilir;
 * silme ise yalnızca kendi aboneliği için yapılır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'
import { badRequest, readJson, serverError } from '@/lib/apiErrors'
import { checkRateLimit } from '@/lib/rateLimiter'
import {
  deletePushSubscription,
  isValidPushEndpoint,
  parsePushSubscription,
  upsertPushSubscription,
} from '@/lib/pushSubscriptionRepository'

const RATE_LIMIT = 20
const RATE_WINDOW_MS = 10 * 60 * 1000

function rateLimited() {
  return NextResponse.json(
    { error: 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.', code: 'RATE_LIMITED' },
    { status: 429 },
  )
}

// ─── POST ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const limit = await checkRateLimit(`push_sub:${employee.id}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!limit.allowed) return rateLimited()

  const body = await readJson(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')
  const parsed = parsePushSubscription(body)
  if (!parsed.ok) return badRequest(parsed.error)

  try {
    const admin = createAdminClient()
    await upsertPushSubscription(admin, employee.id, parsed.value, req.headers.get('user-agent'))
    return NextResponse.json({ success: true })
  } catch (err) {
    return serverError('POST /api/push/subscription', err)
  }
}

// ─── DELETE ─────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const limit = await checkRateLimit(`push_sub:${employee.id}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!limit.allowed) return rateLimited()

  const body = await readJson<{ endpoint?: unknown }>(req)
  // Silmede alan adı listesi aranmaz: liste değişse bile eski kayıt kaldırılabilsin
  if (!body || !isValidPushEndpoint(body.endpoint, { anyHost: true })) {
    return badRequest('Geçersiz abonelik adresi (endpoint).')
  }

  try {
    const admin = createAdminClient()
    const removed = await deletePushSubscription(admin, employee.id, body.endpoint)
    // Kayıt yoksa / başkasına aitse de başarılı döner (idempotent; sahiplik bilgisi sızdırılmaz)
    return NextResponse.json({ success: true, removed })
  } catch (err) {
    return serverError('DELETE /api/push/subscription', err)
  }
}
