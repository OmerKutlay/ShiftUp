/**
 * ShiftUp Service Worker — FAZ 11 PWA
 *
 * Strateji:
 * - Statik asset'ler (JS/CSS/font): Cache First
 * - HTML sayfaları: Network First (fresh content)
 * - API route'ları: Network Only (gerçek zamanlı veri kritik)
 *   Özellikle: /api/attendance, /api/qr, /api/store-location → asla cache'leme
 *
 * Cache'lenecek kritik sayfalar:
 * - /, /dashboard, /attendance/scan, /qr-kiosk, /leave, /schedule, /workforce
 */

const CACHE_NAME = 'shiftup-v1'
const STATIC_CACHE = 'shiftup-static-v1'

// API path'leri — bunlar asla cache'lenmez
const API_NO_CACHE_PATTERNS = [
  '/api/attendance',
  '/api/qr',
  '/api/store-location',
  '/api/notifications',
  '/api/leave',
  '/api/dashboard',
]

// Install: temel sayfaları pre-cache et
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        '/',
        '/manifest.json',
        '/icon-192.svg',
        '/icon-512.svg',
      ]).catch(() => { /* offline pre-cache hatası sessiz */ })
    ).then(() => self.skipWaiting())
  )
})

// Activate: eski cache'leri temizle
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

// Fetch: strateji uygula
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // 1. API route'ları — Network Only (cache kesinlikle yok)
  if (url.pathname.startsWith('/api/') ||
      API_NO_CACHE_PATTERNS.some((p) => url.pathname.startsWith(p))) {
    // Sadece network, hata olursa propagate et
    event.respondWith(fetch(event.request))
    return
  }

  // 2. _next/static — Cache First (immutable build assets)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request)
        if (cached) return cached
        const response = await fetch(event.request)
        if (response.ok) cache.put(event.request, response.clone())
        return response
      })
    )
    return
  }

  // 3. HTML sayfaları — Network First (taze içerik öncelikli)
  if (event.request.mode === 'navigate' ||
      (event.request.method === 'GET' && event.request.headers.get('accept')?.includes('text/html'))) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()))
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
    return
  }

  // 4. Diğer GET istekleri (font, svg, img) — Stale While Revalidate
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request)
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone())
          return response
        }).catch(() => cached)
        return cached ?? fetchPromise
      })
    )
  }
})
