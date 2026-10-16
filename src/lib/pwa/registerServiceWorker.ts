/**
 * registerServiceWorker — /sw.js kaydı ve kullanıcı onaylı güncelleme akışı (istemci tarafı).
 *
 * - Production: SW kaydedilir. Yeni sürüm "waiting" durumuna geçince `onUpdateReady` çağrılır;
 *   kullanıcı onaylarsa `applyUpdate` bekleyen SW'ye SKIP_WAITING gönderir ve kontrol yeni SW'ye
 *   geçtiğinde (controllerchange) sayfa bir kez yenilenir.
 * - Uygulama ön plana döndüğünde (visibilitychange) en fazla UPDATE_CHECK_INTERVAL_MS'de bir
 *   güncelleme kontrolü yapılır — PWA günlerce açık kalabildiğinden tarayıcının kendi kontrolü yetmez.
 * - Development: SW kaydedilmez, varsa kaldırılır ve shiftup-* cache'leri silinir. Turbopack dev
 *   chunk'ları içerik hash'i taşımadığından cache-first strateji eski JS sunar → hydration mismatch.
 */

export const SW_URL = '/sw.js'
/** Ön plana dönüşte güncelleme kontrolü aralığı (30 dk) */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

/** Son kontrolden bu yana yeterince zaman geçti mi? (saat geri alınmışsa da kontrol et) */
export function shouldCheckForUpdate(
  lastCheckAt: number,
  now: number,
  intervalMs = UPDATE_CHECK_INTERVAL_MS
): boolean {
  const elapsed = now - lastCheckAt
  return elapsed < 0 || elapsed >= intervalMs
}

/**
 * Yeni sürüm kullanıcıya sorulmalı mı? Yalnızca sayfa zaten bir SW tarafından kontrol ediliyorsa:
 * ilk kurulumda (controller yok) SW kendiliğinden etkinleşir, sorulacak bir şey yoktur.
 */
export function isUpdateWaiting(
  registration: Pick<ServiceWorkerRegistration, 'waiting'>,
  hasController: boolean
): boolean {
  return hasController && !!registration.waiting
}

/** Dev ortamı: kayıtlı SW'leri kaldır, shiftup-* cache'lerini temizle */
export async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((r) => r.unregister()))
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('shiftup-')).map((k) => caches.delete(k)))
  }
}

let reloading = false

/** Bekleyen SW'yi etkinleştirir; kontrol yeni SW'ye geçince sayfayı bir kez yeniler. */
export function applyUpdate(registration: ServiceWorkerRegistration): void {
  const waiting = registration.waiting
  if (!waiting) {
    window.location.reload()
    return
  }
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    },
    { once: true }
  )
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

export interface RegisterOptions {
  /** Yeni sürüm hazır (waiting) — kullanıcıya "Güncelle" gösterilir */
  onUpdateReady: (registration: ServiceWorkerRegistration) => void
  /** Varsayılan: NODE_ENV === 'production' */
  production?: boolean
}

/**
 * SW'yi kaydeder ve güncelleme dinleyicilerini bağlar. Dönen fonksiyon dinleyicileri kaldırır
 * (kayıt kalır). SSR'da / SW desteği yoksa hiçbir şey yapmaz.
 */
export function registerServiceWorker({
  onUpdateReady,
  production = process.env.NODE_ENV === 'production',
}: RegisterOptions): () => void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return () => {}

  if (!production) {
    unregisterServiceWorkers().catch(() => {})
    return () => {}
  }

  let disposed = false
  let registration: ServiceWorkerRegistration | null = null
  let lastCheckAt = Date.now()
  const sw = navigator.serviceWorker

  const notifyIfWaiting = (reg: ServiceWorkerRegistration) => {
    if (!disposed && isUpdateWaiting(reg, !!sw.controller)) onUpdateReady(reg)
  }

  const onUpdateFound = () => {
    const reg = registration
    const installing = reg?.installing
    if (!reg || !installing) return
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') notifyIfWaiting(reg)
    })
  }

  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible' || !registration) return
    const now = Date.now()
    if (!shouldCheckForUpdate(lastCheckAt, now)) return
    lastCheckAt = now
    registration.update().catch(() => {
      /* çevrimdışı vb. — bir sonraki dönüşte tekrar denenir */
    })
  }

  const register = () => {
    sw.register(SW_URL, { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        if (disposed) return
        registration = reg
        notifyIfWaiting(reg)
        reg.addEventListener('updatefound', onUpdateFound)
        // register() çözülmeden kuruluma başlamış bir SW varsa updatefound kaçırılmış olabilir
        if (reg.installing) onUpdateFound()
      })
      .catch((err) => console.warn('SW registration failed:', err))
  }

  // Kayıt ilk yüklemeyi yavaşlatmasın — sayfa yüklendikten sonra
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    disposed = true
    window.removeEventListener('load', register)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    registration?.removeEventListener('updatefound', onUpdateFound)
  }
}
