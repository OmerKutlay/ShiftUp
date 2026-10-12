/**
 * db — Server-side veri erişimi için tek Supabase handle'ı.
 *
 * Service role client'ı tembel (lazy) oluşturur; RLS'yi bypass ettiği için
 * yetkilendirme her zaman çağıran API route'unda (requireAuth / requireMinRole)
 * yapılmalıdır. Bu modül ve onu kullanan *Repository dosyaları yalnızca
 * server tarafında import edilmelidir — client bileşenleri '@/lib/api/*'
 * altındaki fetch sarmalayıcılarını kullanır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabaseAdmin'

let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (typeof window !== 'undefined') {
    throw new Error('@/lib/db yalnızca server tarafında kullanılabilir.')
  }
  client ??= createAdminClient()
  return client
}

export const db = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const c = getClient()
    const value = Reflect.get(c, prop)
    return typeof value === 'function' ? value.bind(c) : value
  },
})
