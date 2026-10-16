/**
 * GET /sw.js — Service Worker betiği.
 *
 * Statik public/sw.js yerine route handler: sürüm (APP_BUILD_ID) next.config.ts `env` ile build
 * anında gömülür, böylece her deploy yeni bir SW baytı üretir ve tarayıcı güncellemeyi görür.
 * Worker üzerinden sunulduğu için next.config.ts headers() (CSP, no-store) ve middleware burada
 * geçerlidir (public/ dosyaları ise Workers static assets ile doğrudan sunulur, bkz. public/_headers).
 */
import { renderServiceWorker } from '@/lib/pwa/serviceWorkerSource'

// Her istekte üretilir: hiçbir katmanda bayat SW kalmasın (yanıt da no-store)
export const dynamic = 'force-dynamic'

const body = renderServiceWorker(process.env.APP_BUILD_ID)

export function GET() {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
