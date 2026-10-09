/**
 * POST /api/auth/logout
 *
 * Session cookie'yi temizler.
 * AUTH_MODE=development → dev_auth_session cookie'yi siler
 * AUTH_MODE=production  → Supabase Auth signOut
 */
import { NextResponse } from 'next/server'
import { IS_DEV_AUTH, DEV_SESSION_COOKIE } from '@/lib/authConfig'

export async function POST() {
  if (IS_DEV_AUTH) {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(DEV_SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 0, // Hemen sil
    })
    return res
  }

  // Production: Supabase Auth signOut (client-side'da zaten yapılıyor, bu ek güvence)
  return NextResponse.json({ ok: true })
}
