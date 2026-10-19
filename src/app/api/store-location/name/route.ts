/**
 * GET /api/store-location/name — aktif mağazanın yalnızca adı (yan menü başlığı).
 * Giriş yapmış her çalışana açık; konum / yarıçap bilgisi dönmez.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'
import { serverError } from '@/lib/apiErrors'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req, { allowKiosk: true })
  if ('response' in auth) return auth.response

  try {
    const { data, error } = await createAdminClient()
      .from('store_locations')
      .select('name')
      .eq('active', true)
      .limit(1)
      .maybeSingle()
    if (error) return serverError('GET /api/store-location/name', error)
    return NextResponse.json({ name: data?.name ?? null })
  } catch (err) {
    return serverError('GET /api/store-location/name', err)
  }
}
