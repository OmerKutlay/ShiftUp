/**
 * POST /api/stores/active — Admin'in aktif mağazasını değiştirir ({ store_id }).
 *
 * Seçim httpOnly çereze yazılır; getCurrentEmployee her istekte doğrular (mağaza aktif değilse
 * ana mağazaya düşer). Admin olmayanların aktif mağazası her zaman kendi mağazasıdır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { ACTIVE_STORE_COOKIE, ACTIVE_STORE_COOKIE_MAX_AGE } from '@/lib/storeScope'
import { fetchStore } from '@/lib/storeRepository'

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  const body = await readJson<{ store_id?: unknown }>(req)
  if (!body || !isUuid(body.store_id)) return badRequest('Geçersiz mağaza ID.')

  try {
    const store = await fetchStore(body.store_id)
    if (!store || !store.active) return notFound('Mağaza bulunamadı veya pasif.')

    const res = NextResponse.json({ store: { id: store.id, name: store.name } })
    res.cookies.set(ACTIVE_STORE_COOKIE, store.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: ACTIVE_STORE_COOKIE_MAX_AGE,
    })
    return res
  } catch (err) {
    return serverError('POST /api/stores/active', err)
  }
}
