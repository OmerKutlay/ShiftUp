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
import { ADMIN_PENDING_COOKIE, ADMIN_VERIFIED_COOKIE } from '@/lib/auth/adminLogin'

/** Aktif mağaza seçimi ve admin girişi çerezleri de silinir */
function clearActiveStore(res: NextResponse): NextResponse {
  for (const name of [ACTIVE_STORE_COOKIE, ADMIN_VERIFIED_COOKIE, ADMIN_PENDING_COOKIE]) {
    res.cookies.set(name, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  }
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
