/**
 * GEÇİCİ — /push-debug teşhis sayfasının API'si (tüm oturumlu çalışanlar, kiosk hariç).
 *
 * GET  /api/push/debug?endpoint=<bu cihazın endpoint'i>
 *      → { server: { vapidPublicKey }, subscriptions: [...], recent: [...] }
 *      Yalnızca oturumdaki çalışanın kendi cihazları ve son bildirimleri döner.
 * POST /api/push/debug  Body: { delaySeconds?: 0 | 20 }
 *      → kendine 'push_test' bildirimi ekler (INSERT → push tetikleyicisi → send-push).
 *      delaySeconds=20: yanıt hemen döner, bildirim 20 sn sonra eklenir (ctx.waitUntil) —
 *      kullanıcı bu arada uygulamayı kapatıp ekranı kilitler: arka planda teslim testi.
 *
 * Sorun çözülünce sayfa ve bu route kaldırılacak.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'
import { badRequest, readJson, serverError, tooManyRequests } from '@/lib/apiErrors'
import { checkRateLimit } from '@/lib/rateLimiter'
import { createNotification } from '@/lib/notificationRepository'

const TEST_RATE_LIMIT = 6
const TEST_RATE_WINDOW_MS = 10 * 60 * 1000
const ALLOWED_DELAYS = [0, 20]

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).hostname
  } catch {
    return '?'
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth
  const endpoint = req.nextUrl.searchParams.get('endpoint')

  try {
    const admin = createAdminClient()
    const [subs, recent] = await Promise.all([
      admin
        .from('push_subscriptions')
        .select('id, endpoint, user_agent, created_at, last_success_at, failure_count, last_error, last_error_at')
        .eq('employee_id', employee.id)
        .order('created_at', { ascending: false }),
      admin
        .from('notifications')
        .select('id, type, title, created_at, is_read')
        .eq('employee_id', employee.id)
        .order('created_at', { ascending: false })
        .limit(8),
    ])
    if (subs.error) throw subs.error
    if (recent.error) throw recent.error

    return NextResponse.json({
      server: { vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() || null },
      employee: { name: employee.full_name, role: employee.role_name ?? null },
      subscriptions: (subs.data ?? []).map((s) => ({
        id: s.id,
        host: hostOf(s.endpoint as string),
        // Endpoint cihazın push adresidir; yalnızca sonu gösterilir
        endpointTail: (s.endpoint as string).slice(-12),
        thisDevice: endpoint ? s.endpoint === endpoint : null,
        userAgent: s.user_agent,
        createdAt: s.created_at,
        lastSuccessAt: s.last_success_at,
        failureCount: s.failure_count,
        lastError: s.last_error ?? null,
        lastErrorAt: s.last_error_at ?? null,
      })),
      recent: recent.data ?? [],
    })
  } catch (err) {
    return serverError('GET /api/push/debug', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const body = await readJson<{ delaySeconds?: unknown }>(req)
  const delay = Number(body?.delaySeconds ?? 0)
  if (!ALLOWED_DELAYS.includes(delay)) return badRequest('delaySeconds 0 veya 20 olabilir.')

  const limit = await checkRateLimit(`push_debug:${employee.id}`, TEST_RATE_LIMIT, TEST_RATE_WINDOW_MS)
  if (!limit.allowed) return tooManyRequests()

  const send = async () => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay * 1000))
    const time = new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' })
    return createNotification(createAdminClient(), {
      employee_id: employee.id,
      type: 'push_test',
      title: 'Test bildirimi',
      message: `${time} — ${delay > 0 ? 'Arka plan testi' : 'Anlık test'}: bu bildirimi telefonunuzun bildirim panelinde görüyorsanız bildirimler çalışıyor.`,
    })
  }

  try {
    if (delay === 0) {
      const n = await send()
      return NextResponse.json({ notificationId: n?.id ?? null, scheduled: false })
    }
    const p = send().then(
      () => undefined,
      (err) => console.error('[push-debug] gecikmeli test eklenemedi:', err),
    )
    try {
      getCloudflareContext().ctx.waitUntil(p)
    } catch {
      // Workers dışı (yerel geliştirme): söz kendi başına tamamlanır
    }
    return NextResponse.json({ notificationId: null, scheduled: true })
  } catch (err) {
    return serverError('POST /api/push/debug', err)
  }
}
