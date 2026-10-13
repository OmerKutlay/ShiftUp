/**
 * GET /api/kiosk/qr
 *
 * Güncel (tek kullanımlık) kiosk QR'ını döner. Kiosk ekranı bunu yalnızca açılışta ve
 * Realtime kanalı (yeniden) bağlandığında çağırır; sonraki kodlar "kiosk-qr" private
 * kanalından Broadcast ile gelir — periyodik istek yoktur.
 *
 * Yetki: Kiosk rolü veya Müdür Yardımcısı+.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, forbidden } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { checkRateLimit } from '@/lib/rateLimiter'
import { canViewKioskQr, getOrCreateActiveKioskQr } from '@/lib/kioskQrService'
import { serverError } from '@/lib/apiErrors'

// Normalde sayfa açılışı + bağlantı kopmaları; sekme yenileme tekrarları için pay
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, { allowKiosk: true })
  if ('response' in auth) return auth.response
  if (!canViewKioskQr(auth.employee.role_name)) return forbidden()

  try {
    const rate = await checkRateLimit(`kiosk_qr:${auth.employee.id}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Çok fazla istek.', code: 'RATE_LIMITED' }, { status: 429 })
    }
    return NextResponse.json(await getOrCreateActiveKioskQr(createAdminClient()))
  } catch (err) {
    return serverError('GET /api/kiosk/qr', err)
  }
}
