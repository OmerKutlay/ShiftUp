/**
 * GET /api/kiosk/qr
 *
 * Aktif mağaza için kısa ömürlü kiosk anahtarını (KioskSeed) döner. Kiosk ekranı QR kodunu bu
 * anahtarla her dakika YEREL olarak üretir (bkz. kioskQrCode); bu uç yalnızca açılışta ve
 * anahtar bitmeden (KIOSK_SEED_TTL_MS) çağrılır — kod yenilemesi veritabanına gitmez.
 *
 * Mağaza: kiosk hesabı / yönetici / müdür için kendi mağazası; admin için aktif mağaza.
 * Yanıt: { seed, store_id, server_time, step_ms } — server_time ile ekran saat farkını düzeltir.
 * Yetki: Kiosk rolü veya Müdür Yardımcısı+ (canViewKioskQr).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, forbidden } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rateLimiter'
import { canViewKioskQr, issueKioskSeed } from '@/lib/kioskQrService'
import { KIOSK_QR_STEP_MS } from '@/lib/kioskQrCode'
import { serverError } from '@/lib/apiErrors'
import { startTrace, type RequestTrace } from '@/lib/requestTrace'

// Normalde açılış + 12 saatte bir yenileme; sekme yenileme tekrarları için pay
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const trace = startTrace('kiosk_qr', req)
  const res = await getKioskSeed(req, trace)
  trace.end(res.status)
  return res
}

async function getKioskSeed(req: NextRequest, trace: RequestTrace): Promise<NextResponse> {
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
    const seed = await issueKioskSeed(storeId, auth.employee.id)
    trace.step('seed')
    return NextResponse.json(
      { seed, store_id: storeId, server_time: Date.now(), step_ms: KIOSK_QR_STEP_MS },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return serverError('GET /api/kiosk/qr', err)
  }
}
