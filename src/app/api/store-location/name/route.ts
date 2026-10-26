/**
 * GET /api/store-location/name — aktif mağazanın yalnızca adı (yan menü başlığı).
 * Ad `stores` tablosundan gelir (konumun etiketinden değil). Giriş yapmış her çalışana
 * (kiosk dahil) açık; konum / yarıçap bilgisi dönmez.
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
      .from('stores')
      .select('name')
      .eq('id', auth.employee.store_id)
      .maybeSingle()
    if (error) return serverError('GET /api/store-location/name', error)
    return NextResponse.json({ name: data?.name ?? null })
  } catch (err) {
    return serverError('GET /api/store-location/name', err)
  }
}
