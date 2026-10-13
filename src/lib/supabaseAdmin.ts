/**
 * Supabase Admin Client — SADECE server-side (API route) kullanımı için.
 * Secret key (sb_secret_...) frontend'e kesinlikle gönderilmez.
 * Bu dosyayı 'use client' olan hiçbir component'te import etme.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !secretKey) {
  // Build zamanında değil, runtime'da hata ver (Next.js API routes)
  // Test ortamında mock edilir
}

/**
 * Secret key client (service_role rolü) — RLS'yi bypass eder.
 * Sadece server-side API route'larında kullan.
 */
export function createAdminClient() {
  if (!supabaseUrl || !secretKey) {
    throw new Error(
      'Supabase admin client yapılandırılamadı. ' +
      'SUPABASE_SECRET_KEY env değişkeni eksik.'
    )
  }
  return createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
