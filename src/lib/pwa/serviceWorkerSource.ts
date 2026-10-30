/**
 * serviceWorkerSource — /sw.js içeriği (src/app/sw.js/route.ts tarafından sunulur).
 *
 * Neden public/sw.js değil: SW sürümü her deploy'da değişmeli ki tarayıcı yeni SW'yi kursun ve
 * eski cache'ler temizlensin. Statik dosyada sürümü elle artırmak unutuluyordu; build sırasında
 * izlenen dosyayı değiştirmek de çalışma ağacını kirletir. Sürüm next.config.ts `env.APP_BUILD_ID`
 * (commit SHA / zaman damgası) ile build anında gömülür ve buradaki şablona yerleştirilir.
 *
 * Şablon içinde `${…}` yerine string birleştirme kullanılır (TS template literal ile karışmasın).
 *
 * Strateji:
 * - Statik build asset'leri (/_next/static): Cache First (içerik hash'li, değişmez) — en fazla
 *   STATIC_MAX_ENTRIES kayıt tutulur, eskiler silinir.
 * - HTML sayfaları: Network First; ağ yoksa önbellekteki sayfa, o da yoksa /offline.
 * - API route'ları: Network Only (gerçek zamanlı veri; giriş/çıkış asla önbellekten dönmez).
 *   Cloudflare 1102 HTML sayfası JSON hataya çevrilir (bkz. asJsonLimitError).
 * - Sayfa ve RSC istekleri: 1102 503'ünde kısa beklemelerle yeniden denenir.
 * - Diğer GET (ikon, font, görsel): Stale While Revalidate.
 *
 * Güncelleme: ilk kurulumda (aktif SW yokken) hemen etkinleşir. Sonraki sürümler "waiting"
 * durumunda bekler; kullanıcı "Güncelle"ye basınca istemci {type:'SKIP_WAITING'} gönderir
 * (bkz. src/lib/pwa/registerServiceWorker.ts). Böylece açık formlar sürüm ortasında bozulmaz.
 */

/** SW sürüm etiketinde yalnızca güvenli karakterler kalsın (cache adına girer). */
export function normalizeSwVersion(raw: string | undefined | null): string {
  const cleaned = (raw ?? '').replace(/[^\w.-]/g, '').slice(0, 40)
  return cleaned || 'dev'
}

export function renderServiceWorker(rawVersion: string | undefined | null): string {
  const version = normalizeSwVersion(rawVersion)
  return `/* ShiftUp Service Worker — sürüm: ${version} (otomatik üretilir, bkz. src/lib/pwa/serviceWorkerSource.ts) */

// Push / notificationclick handler'ları ayrı dosyada (public/sw-push.js). Dosya yoksa veya
// hata verirse ana SW yine kurulur — önbellek/çevrimdışı davranışı push'a bağımlı değildir.
try {
  importScripts('/sw-push.js')
} catch (err) {
  console.warn('sw-push.js yüklenemedi:', err)
}

const VERSION = ${JSON.stringify(version)}
const CACHE_NAME = 'shiftup-' + VERSION
const STATIC_CACHE = 'shiftup-static-' + VERSION
const STATIC_MAX_ENTRIES = 150
const OFFLINE_URL = '/offline'

const PRECACHE = [
  OFFLINE_URL,
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192.svg',
]

// Install: offline sayfası ve ikonlar. Yalnızca ilk kurulumda (aktif SW yok) hemen etkinleş;
// güncellemeler kullanıcı onayını (SKIP_WAITING mesajı) bekler.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => { /* offline pre-cache hatası kurulumu engellemesin */ })
      .then(() => {
        if (!self.registration.active) return self.skipWaiting()
      })
  )
})

// İstemci "Güncelle" dediğinde bekleyen SW etkinleşir
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

// Activate: eski sürüm cache'lerini temizle
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('shiftup-') && key !== CACHE_NAME && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

/** Cache'te en fazla \`max\` kayıt bırakır (en eski eklenenler silinir) */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= max) return
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)))
}

/** Cloudflare limit hatasında (503) ek denemelerden önceki bekleme süreleri (ms) */
const LIMIT_RETRY_DELAYS = [400, 1200]

/**
 * Sayfa / RSC isteği — Cloudflare 503 (ör. 1102: ücretsiz planda soğuk başlangıç CPU sınırı
 * aşıldı) dönerse kısa beklemelerle yeniden dener; kullanıcı hata sayfasını görmez.
 * Uygulama sayfaları hiçbir zaman kasıtlı 503 döndürmez.
 */
async function fetchRetryingLimit(request) {
  let response = await fetch(request)
  for (const delay of LIMIT_RETRY_DELAYS) {
    if (response.status !== 503) break
    await new Promise((resolve) => setTimeout(resolve, delay))
    response = await fetch(request)
  }
  return response
}

/**
 * API yanıtı Cloudflare'in HTML limit sayfasıysa (1102 → 503) aynı durumla JSON hataya çevirir:
 * res.json() okuyan her ekran teknik "Unexpected token" yerine anlaşılır mesajı gösterir.
 * x-platform-limit başlığı istemcinin (apiFetch) yeniden deneme kararı içindir.
 */
function asJsonLimitError(response) {
  if (response.status !== 503) return response
  if ((response.headers.get('content-type') || '').includes('application/json')) return response
  return new Response(JSON.stringify({ error: 'Sunucu şu an yoğun, lütfen tekrar deneyin.', code: 'PLATFORM_LIMIT' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'X-Platform-Limit': '1', 'Cache-Control': 'no-store' },
  })
}

/** Next.js RSC / router isteği mi (sayfa geçişi, prefetch)? */
function isRscRequest(request, url) {
  return url.searchParams.has('_rsc') ||
    request.headers.has('RSC') ||
    request.headers.has('Next-Router-State-Tree')
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 1. API route'ları (tüm metotlar) — Network Only; yalnızca 1102 sayfası JSON hataya çevrilir.
  // Yeniden deneme istemcidedir (apiFetch yalnızca okumaları tekrarlar; yazmalar asla).
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).then(asJsonLimitError))
    return
  }

  // 0. Yalnızca GET; diğer origin'ler ve /_next iç istekleri — SW devre dışı.
  if (request.method !== 'GET' ||
      url.origin !== self.location.origin ||
      (url.pathname.startsWith('/_next/') && !url.pathname.startsWith('/_next/static/'))) {
    return
  }

  // RSC istekleri asla önbelleğe alınmaz (eski payload güncel HTML/JS ile karışırsa hydration
  // mismatch oluşur); yalnızca 1102 503'ünde yeniden denenir. Aksi halde router hata sayfasına
  // tam sayfa geçişi yapar ve kullanıcı Cloudflare hata ekranını görür.
  if (isRscRequest(request, url)) {
    event.respondWith(fetchRetryingLimit(request))
    return
  }

  // 2. _next/static — Cache First (immutable build assets), boyut sınırlı
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) {
          await cache.put(request, response.clone())
          event.waitUntil(trimCache(STATIC_CACHE, STATIC_MAX_ENTRIES))
        }
        return response
      })
    )
    return
  }

  // 3. HTML sayfaları — Network First, sonra önbellek, sonra /offline
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetchRetryingLimit(request)
        .then((response) => {
          // Yalnızca doğrudan 200 sayfalar (yönlendirmeler/hata sayfaları değil)
          if (response.ok && !response.redirected) {
            const copy = response.clone()
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)))
          }
          return response
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match(OFFLINE_URL)) ?? Response.error())
    )
    return
  }

  // 4. Diğer GET istekleri (font, svg, png) — Stale While Revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone())
          return response
        })
        .catch(() => cached ?? Response.error())
      return cached ?? network
    })
  )
})
`
}
