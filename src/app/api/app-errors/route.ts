/**
 * GET /api/app-errors — son 100 uygulama hatası (salt okunur), yalnızca Admin.
 * Admin şirket genelinde yetkilidir; kayıtlar tüm mağazaları kapsar (store_id ile birlikte döner).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { serverError } from '@/lib/apiErrors'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.ADMIN)
  if ('response' in auth) return auth.response

  try {
    const { data, error } = await createAdminClient()
      .from('app_errors')
      .select('id, created_at, source, message, stack, request_id, employee_id, store_id, meta')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return serverError('GET /api/app-errors', error)
    return NextResponse.json({ errors: data ?? [] })
  } catch (err) {
    return serverError('GET /api/app-errors', err)
  }
}
