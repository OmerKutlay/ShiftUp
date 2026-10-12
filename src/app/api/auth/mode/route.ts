/**
 * GET /api/auth/mode
 *
 * Client'a authentication modunu bildirir.
 * AUTH_MODE env'ini doğrudan client'a expose etmek yerine
 * bu endpoint üzerinden güvenli şekilde iletilir.
 * DEV_OTP değeri asla client'a gönderilmez.
 */
import { NextResponse } from 'next/server'
import { AUTH_MODE } from '@/lib/authConfig'

export async function GET() {
  return NextResponse.json({ mode: AUTH_MODE })
}
