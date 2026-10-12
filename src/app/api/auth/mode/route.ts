/**
 * GET /api/auth/mode
 *
 * Client'a authentication modunu bildirir.
 * AUTH_MODE env'ini doğrudan client'a expose etmek yerine
 * bu endpoint üzerinden güvenli şekilde iletilir.
 * DEV_OTP değeri asla client'a gönderilmez.
 */
import { NextResponse } from 'next/server'
import { connection } from 'next/server'
import { AUTH_MODE } from '@/lib/authConfig'

export async function GET() {
  // cacheComponents açıkken istek verisi kullanmayan GET handler build'de prerender edilir;
  // AUTH_MODE runtime env'den okunmalı, bu yüzden isteğe bağlı (dinamik) kalmasını sağlıyoruz
  await connection()
  return NextResponse.json({ mode: AUTH_MODE })
}
