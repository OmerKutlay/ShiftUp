/**
 * createSupabaseMiddlewareClient — Next.js middleware için.
 *
 * next/headers kullanmaz — NextRequest/NextResponse cookies ile çalışır.
 * middleware.ts'ten statik import edilebilir.
 */
import { createServerClient } from '@supabase/ssr'
import type { NextRequest, NextResponse } from 'next/server'
import { SUPABASE_COOKIE_OPTIONS } from '@/lib/auth/sessionAge'

export function createSupabaseMiddlewareClient(
  request: NextRequest,
  response: NextResponse
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

  return createServerClient(url, key, {
    cookieOptions: SUPABASE_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })
}
