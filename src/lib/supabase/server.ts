/**
 * createSupabaseServerClient — Server Components ve Route Handlers için.
 *
 * next/headers kullandığı için yalnızca gerçek server context'te çalışır.
 * Bu dosyayı doğrudan import etmek yerine dynamic import kullan:
 *
 *   const { createSupabaseServerClient } = await import('@/lib/supabase/server')
 *
 * Bu sayede webpack bu dosyayı client bundle'a dahil etmez.
 */
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Supabase env variables missing: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        } catch {
          // Server Component'ten çağrıldığında set izni olmayabilir
        }
      },
    },
  })
}
