/**
 * @/lib/supabase barrel export
 *
 * Browser/client: getSupabaseBrowserClient()
 *
 * Server (Route Handlers, Server Components) — dynamic import zorunlu:
 *   const { createSupabaseServerClient } = await import('@/lib/supabase/server')
 *
 * Middleware — statik import güvenli:
 *   import { createSupabaseMiddlewareClient } from '@/lib/supabase/middleware-client'
 */
export { getSupabaseBrowserClient } from './client'
export { createSupabaseMiddlewareClient } from './middleware-client'
// createSupabaseServerClient burada export edilmez — next/headers taşıdığı için
// dynamic import ile kullanılmalı: await import('@/lib/supabase/server')
