/**
 * Push abonelikleri — doğrulama + sunucu tarafı veri erişimi.
 * Gönderim send-push Edge Function'ındadır (notifications tetikleyicisi → pg_net).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const MAX_ENDPOINT_LENGTH = 2048
const BASE64URL_RE = /^[A-Za-z0-9_-]+={0,2}$/

/**
 * İzin verilen push servisi alan adları. Edge Function abonelik adresine istek attığı için
 * keyfi adres kabul edilmez (sunucudan rastgele HTTPS isteği yaptırma / SSRF önlemi).
 * Chrome/Edge(Chromium)/Samsung/Opera: FCM · Firefox: Mozilla · Safari: Apple · eski Edge: WNS
 */
const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com']
const PUSH_SERVICE_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com']

export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
}

function isBase64Url(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max && BASE64URL_RE.test(value)
}

/**
 * Abonelik adresi HTTPS ve bilinen bir push servisine mi ait?
 * anyHost: yalnızca biçim kontrolü (silme gibi dışarı istek yapılmayan işlemler için).
 */
export function isValidPushEndpoint(value: unknown, { anyHost = false } = {}): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  if (anyHost) return true
  const host = url.hostname.toLowerCase()
  return PUSH_SERVICE_HOSTS.includes(host) || PUSH_SERVICE_SUFFIXES.some((s) => host.endsWith(s))
}

/**
 * PushSubscription.toJSON() gövdesini doğrular: { endpoint, keys: { p256dh, auth } }.
 * p256dh: 65 baytlık P-256 açık anahtar (~87 karakter), auth: 16 bayt (~22 karakter).
 */
export function parsePushSubscription(
  body: unknown,
): { ok: true; value: PushSubscriptionInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Geçersiz istek gövdesi.' }
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null }
  if (!isValidPushEndpoint(b.endpoint)) return { ok: false, error: 'Geçersiz abonelik adresi (endpoint).' }
  const keys = b.keys && typeof b.keys === 'object' ? b.keys : {}
  if (!isBase64Url(keys.p256dh, 80, 100)) return { ok: false, error: 'Geçersiz p256dh anahtarı.' }
  if (!isBase64Url(keys.auth, 16, 32)) return { ok: false, error: 'Geçersiz auth anahtarı.' }
  return { ok: true, value: { endpoint: b.endpoint, p256dh: keys.p256dh, auth: keys.auth } }
}

/**
 * Aboneliği endpoint'e göre ekler/günceller. Aynı cihaz başka bir hesapla açıldıysa
 * (cihaz el değiştirdi) kayıt yeni çalışana devredilir ve hata sayacı sıfırlanır.
 */
export async function upsertPushSubscription(
  admin: SupabaseClient,
  employeeId: string,
  input: PushSubscriptionInput,
  userAgent: string | null,
): Promise<void> {
  const { error } = await admin.from('push_subscriptions').upsert(
    {
      employee_id: employeeId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: userAgent ? userAgent.slice(0, 300) : null,
      failure_count: 0,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
  await trimPushSubscriptions(admin, employeeId, input.endpoint)
}

/** Çalışan başına en fazla bu kadar cihaz aboneliği tutulur (sahte abonelikle push çoğaltmayı önler) */
export const MAX_SUBSCRIPTIONS_PER_EMPLOYEE = 10

/** Sınırı aşan en eski abonelikleri siler; az önce kaydedilen endpoint her zaman korunur */
async function trimPushSubscriptions(
  admin: SupabaseClient,
  employeeId: string,
  keepEndpoint: string,
): Promise<void> {
  const { data, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const others = (data ?? []).filter((row) => row.endpoint !== keepEndpoint)
  const excess = others.slice(MAX_SUBSCRIPTIONS_PER_EMPLOYEE - 1).map((row) => row.id as string)
  if (excess.length === 0) return
  const { error: delError } = await admin.from('push_subscriptions').delete().in('id', excess)
  if (delError) throw delError
}

/** Yalnızca çalışanın kendi aboneliğini siler; silinen kayıt sayısını döner */
export async function deletePushSubscription(
  admin: SupabaseClient,
  employeeId: string,
  endpoint: string,
): Promise<number> {
  const { data, error } = await admin
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('employee_id', employeeId)
    .select('id')
  if (error) throw error
  return (data ?? []).length
}
