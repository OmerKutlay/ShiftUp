/**
 * POST /api/auth/logout
 *
 * Session cookie'yi temizler.
 * AUTH_MODE=development → dev_auth_session cookie'yi siler
 * AUTH_MODE=production  → Supabase Auth signOut
 * Her iki modda admin'in aktif mağaza seçimi de silinir (cihazı sonraki kullanan kendi mağazasıyla başlar).
 */
import { NextResponse } from 'next/server'
import { IS_DEV_AUTH, DEV_SESSION_COOKIE } from '@/lib/authConfig'
import { ACTIVE_STORE_COOKIE } from '@/lib/storeScope'

function clearActiveStore(res: NextResponse): NextResponse {
  res.cookies.set(ACTIVE_STORE_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}

export async function POST() {
  if (IS_DEV_AUTH) {
    const res = NextResponse.json({ ok: true })
    res.cookies.set(DEV_SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 0, // Hemen sil
    })
    return clearActiveStore(res)
  }

  // Production: Supabase Auth signOut — refresh token iptal edilir, session cookie'leri silinir
  try {
    const { createSupabaseServerClient } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  } catch (err) {
    console.error('[POST /api/auth/logout]', err)
  }
  return clearActiveStore(NextResponse.json({ ok: true }))
}
