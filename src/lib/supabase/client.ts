/**
 * Browser-side Supabase client — @supabase/ssr createBrowserClient
 *
 * Cookie tabanlı session yönetimi için kullanılır.
 * 'use client' bileşenlerinde ve client-side hook'larda import edilir.
 *
 * Singleton: Her render'da yeni client oluşturmak yerine tek örnek döner.
 */
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Supabase env variables missing: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  _client = createBrowserClient(url, key)
  return _client
}
