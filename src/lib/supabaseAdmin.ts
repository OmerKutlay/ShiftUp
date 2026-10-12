/**
 * Supabase Admin Client — SADECE server-side (API route) kullanımı için.
 * Service role key frontend'e kesinlikle gönderilmez.
 * Bu dosyayı 'use client' olan hiçbir component'te import etme.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  // Build zamanında değil, runtime'da hata ver (Next.js API routes)
  // Test ortamında mock edilir
}

/**
 * Service role client — RLS'yi bypass eder.
 * Sadece server-side API route'larında kullan.
 */
export function createAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Supabase admin client yapılandırılamadı. ' +
      'SUPABASE_SERVICE_ROLE_KEY env değişkeni eksik.'
    )
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
