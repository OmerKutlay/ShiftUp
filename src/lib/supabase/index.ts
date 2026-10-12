/**
 * @/lib/supabase barrel export
 *
 * Browser: tablo verisine doğrudan erişim YOK — client bileşenleri '@/lib/api/*' fetch
 * sarmalayıcılarını kullanır; tüm veri API route'larından (service role) geçer.
 *
 * Server (Route Handlers, Server Components) — dynamic import zorunlu:
 *   const { createSupabaseServerClient } = await import('@/lib/supabase/server')
 *
 * Middleware — statik import güvenli:
 *   import { createSupabaseMiddlewareClient } from '@/lib/supabase/middleware-client'
 */
export { createSupabaseMiddlewareClient } from './middleware-client'
// createSupabaseServerClient burada export edilmez — next/headers taşıdığı için
// dynamic import ile kullanılmalı: await import('@/lib/supabase/server')
