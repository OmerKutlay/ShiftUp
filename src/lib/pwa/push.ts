/**
 * push — istemci tarafı Web Push aboneliği (yalnızca tarayıcıda çağrılır).
 *
 * Akış: /api/push/config → Notification.requestPermission → pushManager.subscribe
 *       (VAPID açık anahtarı) → POST /api/push/subscription.
 * Bildirimi gösteren taraf service worker'dır (public/sw-push.js).
 *
 * iOS/iPadOS: Web Push yalnızca 16.4+ sürümde ve uygulama ana ekrana eklenip
 * oradan (standalone) açıldığında çalışır; Safari sekmesinde PushManager yoktur.
 */
import { onBeforeSignOut } from './sessionEvents'
import { reportClientError } from '@/lib/api/clientErrors'

export type PushAvailability = 'supported' | 'unsupported' | 'ios-needs-install' | 'ios-too-old'
export type PushPermission = NotificationPermission | 'unsupported'

export interface PushConfig {
  enabled: boolean
  publicKey: string | null
}

export type SubscribeResult =
  | { ok: true }
  | {
      ok: false
      reason: 'unsupported' | 'disabled' | 'denied' | 'dismissed' | 'no-service-worker' | 'error'
      /** Teknik ayrıntı (hata adı/mesajı, sunucu yanıtı) — teşhis sayfası ve hata günlüğü için */
      detail?: string
    }

/** Etkin service worker beklenirken üst sınır */
const SW_READY_TIMEOUT_MS = 10_000

const SUBSCRIPTION_API = '/api/push/subscription'

// ─── Ortam algılama ──────────────────────────────────────────

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined'
}

/** iPhone / iPad (iPadOS masaüstü UA'sı dahil) */
export function isIos(): boolean {
  if (!hasWindow()) return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

/** iOS ana sürümü (ör. 17) — algılanamazsa null */
export function iosMajorVersion(): number | null {
  if (!hasWindow()) return null
  const m = navigator.userAgent.match(/OS (\d+)[_.](\d+)/)
  return m ? Number(m[1]) : null
}

/** Ana ekrana eklenmiş uygulama olarak mı açıldı? */
export function isStandalone(): boolean {
  if (!hasWindow()) return false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
}

/** Tarayıcı Web Push API'lerini sunuyor mu? */
export function isPushSupported(): boolean {
  return hasWindow() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** Bu cihazda push kullanılabilir mi; değilse neden? */
export function getPushAvailability(): PushAvailability {
  if (isIos()) {
    const v = iosMajorVersion()
    // iPadOS masaüstü UA'sında sürüm bulunmaz → kurulum durumuna göre karar ver
    if (v !== null && v < 16) return 'ios-too-old'
    if (!isStandalone()) return 'ios-needs-install'
    return isPushSupported() ? 'supported' : 'ios-too-old'
  }
  return isPushSupported() ? 'supported' : 'unsupported'
}

export function getPermissionState(): PushPermission {
  if (!hasWindow() || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

// ─── Yardımcılar ─────────────────────────────────────────────

/** base64url (VAPID açık anahtarı) → Uint8Array */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** ArrayBuffer → base64url (padding'siz) */
export function bufferToUrlBase64(buf: ArrayBuffer | null | undefined): string | null {
  if (!buf) return null
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null
  } catch {
    return null
  }
}

/**
 * Etkin (active) SW'si olan kayıt. pushManager.subscribe etkin SW ister; ilk açılışta SW henüz
 * kaydedilmemiş / kuruluyor olabilir ("no active Service Worker") → hazır olmasını bekle.
 */
async function getActiveRegistration(): Promise<ServiceWorkerRegistration | null> {
  const reg = await getRegistration()
  if (reg?.active || !isPushSupported()) return reg
  const ready = navigator.serviceWorker.ready
  if (!ready) return reg
  const timeout = new Promise<ServiceWorkerRegistration | null>((resolve) => {
    setTimeout(() => resolve(reg), SW_READY_TIMEOUT_MS)
  })
  return Promise.race([ready.catch(() => reg), timeout])
}

/** Hata → "Ad: mesaj" (teşhis için) */
export function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown }
    const name = typeof e.name === 'string' ? e.name : 'Error'
    return typeof e.message === 'string' && e.message ? `${name}: ${e.message}` : name
  }
  return String(err)
}

/** Bu cihazdaki mevcut push aboneliği (yoksa null) */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration()
  if (!reg) return null
  try {
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

export async function fetchPushConfig(): Promise<PushConfig> {
  try {
    const res = await fetch('/api/push/config', { credentials: 'same-origin' })
    if (!res.ok) return { enabled: false, publicKey: null }
    const json = (await res.json()) as Partial<PushConfig>
    return { enabled: Boolean(json.enabled && json.publicKey), publicKey: json.publicKey ?? null }
  } catch {
    return { enabled: false, publicKey: null }
  }
}

/** Aboneliği sunucuya kaydeder; başarısızsa sunucunun hata metnini döner */
async function saveSubscription(sub: PushSubscription): Promise<{ ok: true } | { ok: false; detail: string }> {
  const res = await fetch(SUBSCRIPTION_API, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
  if (res.ok) return { ok: true }
  let message = ''
  try {
    message = ((await res.json()) as { error?: string }).error ?? ''
  } catch {
    /* gövde JSON değil */
  }
  let host = ''
  try {
    host = new URL(sub.endpoint).hostname
  } catch {
    /* geçersiz endpoint */
  }
  return {
    ok: false,
    detail: `Sunucu kaydı HTTP ${res.status}${message ? ` — ${message}` : ''}${host ? ` (push servisi: ${host})` : ''}`,
  }
}

/** Abonelik hatası: sunucu günlüğüne (app_errors) yazılır, ayrıntıyla döner */
function subscribeError(detail: string): SubscribeResult {
  reportClientError('push-subscribe', new Error(detail))
  return { ok: false, reason: 'error', detail }
}

// ─── Abone ol / çık ──────────────────────────────────────────

/**
 * İzin ister, cihazı abone eder ve sunucuya kaydeder.
 * Kullanıcı etkileşimi (tıklama) içinde çağrılmalıdır — iOS başka türlü izin penceresi açmaz.
 */
export async function subscribe(): Promise<SubscribeResult> {
  if (getPushAvailability() !== 'supported') return { ok: false, reason: 'unsupported' }

  const config = await fetchPushConfig()
  if (!config.enabled || !config.publicKey) return { ok: false, reason: 'disabled' }

  let permission = Notification.permission
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission()
    } catch (err) {
      return subscribeError(`requestPermission: ${describeError(err)}`)
    }
  }
  if (permission === 'denied') return { ok: false, reason: 'denied' }
  if (permission !== 'granted') return { ok: false, reason: 'dismissed' }

  const reg = await getActiveRegistration()
  if (!reg) {
    reportClientError('push-subscribe', new Error('Service worker kaydı yok'))
    return { ok: false, reason: 'no-service-worker', detail: 'Service worker kaydı yok' }
  }

  try {
    let sub = await reg.pushManager.getSubscription()
    // VAPID anahtarı değiştiyse eski abonelik yeni anahtarla çalışmaz → yenile
    if (sub && bufferToUrlBase64(sub.options.applicationServerKey) !== config.publicKey.replace(/=+$/, '')) {
      await sub.unsubscribe().catch(() => false)
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    })
    const saved = await saveSubscription(sub)
    return saved.ok ? { ok: true } : subscribeError(saved.detail)
  } catch (err) {
    return subscribeError(`pushManager.subscribe: ${describeError(err)}`)
  }
}

/** Bu cihazın aboneliğini sunucudan ve tarayıcıdan kaldırır */
export async function unsubscribe(): Promise<boolean> {
  const sub = await getCurrentSubscription()
  if (!sub) return true
  try {
    await fetch(SUBSCRIPTION_API, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    })
  } catch {
    /* sunucu kaydı kalsa bile tarayıcı aboneliği aşağıda kaldırılır → push servisi 410 döner */
  }
  try {
    return await sub.unsubscribe()
  } catch {
    return false
  }
}

/**
 * İzin verilmişse aboneliği sunucuya yeniden kaydeder (oturum başına bir kez çağrılır).
 * Cihaz başka hesapla açıldıysa kayıt bu hesaba devredilir; SW'nin kaçırdığı
 * pushsubscriptionchange yenilemeleri de böylece sunucuya ulaşır.
 * İzin var ama abonelik yoksa (ör. çıkış → yeniden giriş) sessizce yeniden abone olunur;
 * izin zaten verildiği için kullanıcı etkileşimi gerekmez.
 */
export async function syncSubscription(): Promise<boolean> {
  if (getPermissionState() !== 'granted') return false
  const sub = await getCurrentSubscription()
  if (!sub) return (await subscribe()).ok
  try {
    return (await saveSubscription(sub)).ok
  } catch {
    return false
  }
}

let signOutHookRegistered = false

/** Çıkışta bu cihazın aboneliğini kaldıran kancayı (bir kez) kaydeder */
export function registerPushSignOutHook(): void {
  if (signOutHookRegistered || !hasWindow()) return
  signOutHookRegistered = true
  onBeforeSignOut(async () => {
    // Uygulama ikonundaki okunmamış rozeti de temizle (sonraki kullanıcıya sızmasın)
    const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> }
    void nav.clearAppBadge?.()?.catch(() => {})
    await unsubscribe()
  })
}
