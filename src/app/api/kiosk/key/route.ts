/**
 * POST /api/kiosk/key
 *
 * Kiosk ekranına kısa ömürlü QR imzalama anahtarı ("access token") verir.
 * Kiosk QR kodlarını bu anahtarla tarayıcıda kendisi üretir; sunucuya yalnızca anahtar
 * süresi dolmadan önce (saatte ~1) gelir. Oturumun kendisi (refresh) Supabase Auth
 * çerezleriyle middleware'de döner.
 *
 * Yetki: Kiosk rolü veya Müdür Yardımcısı+.
 * Yanıt gizli anahtar içerdiği için önbelleğe alınmaz (next.config: /api no-store).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, forbidden } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { checkRateLimit } from '@/lib/rateLimiter'
import { canIssueKioskKey, issueKioskKey } from '@/lib/kioskKeyService'
import { serverError } from '@/lib/apiErrors'

// Normalde saatte 1; sekme yeniden yükleme / ağ hatası tekrarları için pay
const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req, { allowKiosk: true })
  if ('response' in auth) return auth.response
  if (!canIssueKioskKey(auth.employee.role_name)) return forbidden()

  try {
    const rate = await checkRateLimit(`kiosk_key:${auth.employee.id}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Çok fazla anahtar talebi.', code: 'RATE_LIMITED' }, { status: 429 })
    }
    const key = await issueKioskKey(createAdminClient(), auth.employee.id)
    return NextResponse.json(key, { status: 201 })
  } catch (err) {
    return serverError('POST /api/kiosk/key', err)
  }
}
