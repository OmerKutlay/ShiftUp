/**
 * send-push — notifications tablosuna eklenen kayıtları Web Push ile cihazlara iletir.
 *
 * Çağıran: 20261016100000_push_subscriptions.sql'deki trg_notifications_push_fanout
 * (pg_net, ifade başına tek POST). Gövde: { notification_ids: uuid[] }.
 * Kimlik doğrulama: `x-push-secret` başlığı = PUSH_WEBHOOK_SECRET (sabit zamanlı karşılaştırma).
 * JWT doğrulaması kapalıdır (supabase/config.toml → [functions.send-push] verify_jwt = false).
 *
 * İçerik istek gövdesinden değil veritabanından okunur: anahtar sızsa bile yalnızca mevcut
 * bildirimler sahiplerine yeniden gönderilebilir, keyfi metin gönderilemez.
 *
 * Ortam: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), PUSH_WEBHOOK_SECRET,
 *        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (son ikisi Supabase tarafından otomatik verilir).
 */
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.49.4'
import { isUrgentType, notificationLink } from './links.ts'

const MAX_IDS = 500
/** Push servisi cihaz çevrimdışıyken mesajı en fazla 1 gün saklasın */
const TTL_SECONDS = 24 * 60 * 60
/** Bundan eski bildirimler (ör. gecikmiş/yeniden denenmiş istek) push olarak gönderilmez */
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Ardışık bu kadar başarısız gönderimden sonra abonelik silinir */
const MAX_FAILURES = 20
const CONCURRENCY = 20
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface NotificationRow {
  id: string
  employee_id: string
  type: string
  title: string
  message: string
  related_id: string | null
  created_at: string
}

interface SubscriptionRow {
  id: string
  employee_id: string
  endpoint: string
  p256dh: string | null
  auth: string | null
  failure_count: number
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Sabit zamanlı karşılaştırma: iki değerin SHA-256 özetleri bayt bayt XOR'lanır */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ])
  const va = new Uint8Array(ha)
  const vb = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Görevleri en fazla `limit` eşzamanlı çalıştırır */
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? ''
const WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? ''
const vapidReady = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT)
if (vapidReady) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!WEBHOOK_SECRET) return json({ error: 'PUSH_WEBHOOK_SECRET tanımlı değil' }, 500)
  const provided = req.headers.get('x-push-secret') ?? ''
  if (!(await safeEqual(provided, WEBHOOK_SECRET))) return json({ error: 'Unauthorized' }, 401)

  if (!vapidReady) return json({ error: 'VAPID anahtarları tanımlı değil' }, 503)

  let ids: string[]
  try {
    const body = (await req.json()) as { notification_ids?: unknown }
    ids = Array.isArray(body.notification_ids)
      ? body.notification_ids.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
      : []
  } catch {
    return json({ error: 'Geçersiz gövde' }, 400)
  }
  ids = [...new Set(ids)].slice(0, MAX_IDS)
  if (ids.length === 0) return json({ sent: 0, failed: 0, removed: 0 })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: notifData, error: notifErr } = await admin
    .from('notifications')
    .select('id, employee_id, type, title, message, related_id, created_at')
    .in('id', ids)
  if (notifErr) {
    console.error('[send-push] notifications okunamadı', notifErr.message)
    return json({ error: 'DB hatası' }, 500)
  }
  const cutoff = Date.now() - MAX_AGE_MS
  const notifications = ((notifData ?? []) as NotificationRow[]).filter(
    (n) => new Date(n.created_at).getTime() >= cutoff,
  )
  if (notifications.length === 0) return json({ sent: 0, failed: 0, removed: 0 })

  const employeeIds = [...new Set(notifications.map((n) => n.employee_id))]
  const { data: subData, error: subErr } = await admin
    .from('push_subscriptions')
    .select('id, employee_id, endpoint, p256dh, auth, failure_count')
    .in('employee_id', employeeIds)
  if (subErr) {
    console.error('[send-push] push_subscriptions okunamadı', subErr.message)
    return json({ error: 'DB hatası' }, 500)
  }
  const subsByEmployee = new Map<string, SubscriptionRow[]>()
  for (const s of (subData ?? []) as SubscriptionRow[]) {
    if (!s.p256dh || !s.auth) continue
    const list = subsByEmployee.get(s.employee_id) ?? []
    list.push(s)
    subsByEmployee.set(s.employee_id, list)
  }

  // Uygulama ikonu rozeti için çalışan başına okunmamış sayısı
  const unread = new Map<string, number>()
  await Promise.all(
    employeeIds
      .filter((id) => subsByEmployee.has(id))
      .map(async (id) => {
        const { count } = await admin
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('employee_id', id)
          .eq('is_read', false)
        if (typeof count === 'number') unread.set(id, count)
      }),
  )

  const jobs: { n: NotificationRow; s: SubscriptionRow }[] = []
  for (const n of notifications) {
    for (const s of subsByEmployee.get(n.employee_id) ?? []) jobs.push({ n, s })
  }

  const succeeded = new Set<string>()
  const gone = new Set<string>()
  const failed = new Map<string, number>()

  await runPool(jobs, CONCURRENCY, async ({ n, s }) => {
    const payload = JSON.stringify({
      title: truncate(n.title, 120),
      body: truncate(n.message, 300),
      url: notificationLink(n.type),
      tag: `${n.type}:${n.related_id ?? n.id}`,
      notificationId: n.id,
      type: n.type,
      unreadCount: unread.get(n.employee_id) ?? null,
    })
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh!, auth: s.auth! } },
        payload,
        { TTL: TTL_SECONDS, urgency: isUrgentType(n.type) ? 'high' : 'normal' },
      )
      succeeded.add(s.id)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        // Abonelik push servisinde artık yok (izin kaldırıldı / uygulama silindi)
        gone.add(s.id)
      } else {
        failed.set(s.id, s.failure_count + 1)
        console.warn('[send-push] gönderilemedi', status ?? (err as Error).message)
      }
    }
  })

  // Sonuçları kaydet
  const now = new Date().toISOString()
  const toDelete = [...gone]
  const ops: PromiseLike<unknown>[] = []
  for (const [id, count] of failed) {
    if (succeeded.has(id) || gone.has(id)) continue
    if (count >= MAX_FAILURES) toDelete.push(id)
    else ops.push(admin.from('push_subscriptions').update({ failure_count: count }).eq('id', id))
  }
  const okIds = [...succeeded].filter((id) => !gone.has(id))
  if (okIds.length > 0) {
    ops.push(
      admin.from('push_subscriptions').update({ last_success_at: now, failure_count: 0 }).in('id', okIds),
    )
  }
  if (toDelete.length > 0) ops.push(admin.from('push_subscriptions').delete().in('id', toDelete))
  await Promise.all(ops)

  return json({ sent: okIds.length, failed: failed.size, removed: toDelete.length })
})
