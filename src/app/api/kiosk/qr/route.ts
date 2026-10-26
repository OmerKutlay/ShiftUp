/**
 * GET /api/kiosk/qr
 *
 * Aktif mağazanın güncel (tek kullanımlık) kiosk QR'ını döner. Kiosk ekranı bunu yalnızca
 * açılışta ve Realtime kanalı (yeniden) bağlandığında çağırır; sonraki kodlar mağazanın
 * "kiosk-qr:<store_id>" private kanalından Broadcast ile gelir — periyodik istek yoktur.
 *
 * Mağaza: kiosk hesabı / yönetici / müdür için kendi mağazası; admin için aktif mağaza.
 * Yanıt: { qr_data, store_id, topic } — istemci `topic` kanalına abone olur.
 * Yetki: Kiosk rolü veya Müdür Yardımcısı+ (SQL: can_view_kiosk_qr_topic ile aynı kural).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, forbidden } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { checkRateLimit } from '@/lib/rateLimiter'
import { canViewKioskQr, getOrCreateActiveKioskQr, kioskQrTopic } from '@/lib/kioskQrService'
import { serverError } from '@/lib/apiErrors'
import { startTrace, type RequestTrace } from '@/lib/requestTrace'

// Normalde sayfa açılışı + bağlantı kopmaları; sekme yenileme tekrarları için pay
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const trace = startTrace('kiosk_qr', req)
  const res = await getKioskQr(req, trace)
  trace.end(res.status)
  return res
}

async function getKioskQr(req: NextRequest, trace: RequestTrace): Promise<NextResponse> {
  const auth = await requireAuth(req, { allowKiosk: true })
  trace.step('auth', { ok: !('response' in auth) })
  if ('response' in auth) return auth.response
  const storeId = auth.employee.store_id
  if (!canViewKioskQr(auth.employee.access_level, auth.employee.home_store_id, storeId)) return forbidden()

  try {
    const rate = await checkRateLimit(`kiosk_qr:${auth.employee.id}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
    trace.step('rate_limit', { employee_id: auth.employee.id, allowed: rate.allowed })
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Çok fazla istek.', code: 'RATE_LIMITED' }, { status: 429 })
    }
    const qr = await getOrCreateActiveKioskQr(createAdminClient(), storeId)
    trace.step('active_qr')
    return NextResponse.json({ ...qr, store_id: storeId, topic: kioskQrTopic(storeId) })
  } catch (err) {
    return serverError('GET /api/kiosk/qr', err)
  }
}
