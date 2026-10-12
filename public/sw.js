/**
 * ShiftUp Service Worker — PWA
 *
 * Strateji:
 * - Statik build asset'leri (/_next/static): Cache First (içerik hash'li, değişmez) — en fazla
 *   STATIC_MAX_ENTRIES kayıt tutulur, eskiler silinir.
 * - HTML sayfaları: Network First; ağ yoksa önbellekteki sayfa, o da yoksa /offline.
 * - API route'ları: Network Only (gerçek zamanlı veri; giriş/çıkış asla önbellekten dönmez).
 * - Diğer GET (ikon, font, görsel): Stale While Revalidate.
 */

const VERSION = 'v4'
const CACHE_NAME = `shiftup-${VERSION}`
const STATIC_CACHE = `shiftup-static-${VERSION}`
const STATIC_MAX_ENTRIES = 150
const OFFLINE_URL = '/offline'

const PRECACHE = [
  OFFLINE_URL,
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192.svg',
]

// Install: offline sayfası ve ikonlar
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => { /* offline pre-cache hatası kurulumu engellemesin */ })
      .then(() => self.skipWaiting())
  )
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

/** Cache'te en fazla `max` kayıt bırakır (en eski eklenenler silinir) */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= max) return
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)))
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 0. Yalnızca GET; diğer origin'ler ve Next.js RSC / router istekleri — SW devre dışı.
  // Cache'ten gelen eski RSC payload'ı güncel HTML/JS ile karışırsa hydration mismatch oluşur.
  if (request.method !== 'GET' ||
      url.origin !== self.location.origin ||
      url.searchParams.has('_rsc') ||
      request.headers.has('RSC') ||
      request.headers.has('Next-Router-State-Tree') ||
      (url.pathname.startsWith('/_next/') && !url.pathname.startsWith('/_next/static/'))) {
    return
  }

  // 1. API route'ları — Network Only
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request))
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
      fetch(request)
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
