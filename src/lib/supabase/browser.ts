'use client'

/**
 * Tarayıcı Supabase istemcisi — YALNIZCA Realtime (kiosk QR yayını) için.
 *
 * Tablo verisine buradan erişilmez (anon/authenticated için tüm tablolar kapalı; veri
 * API route'larından gelir). Oturum, @supabase/ssr'ın sunucuda yazdığı çerezlerden okunur;
 * access token yenilendikçe Realtime bağlantısına otomatik iletilir.
 */
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
  return client
}
