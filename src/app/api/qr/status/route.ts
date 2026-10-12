/**
 * GET /api/qr/status?token=...
 *
 * Kiosk ekranı, gösterdiği QR'ın okutulup okutulmadığını bu endpoint ile yoklar.
 * Token kullanıldıysa kiosk hemen yeni QR üretir. Yalnızca kiosk'u çalıştıran
 * yöneticiler (Müdür Yardımcısı+) erişebilir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { badRequest, serverError } from '@/lib/apiErrors'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  const token = req.nextUrl.searchParams.get('token')
  if (!token || token.length > 128) return badRequest('token zorunludur.')

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('qr_tokens')
    .select('used_at')
    .eq('token', token)
    .maybeSingle()

  if (error) return serverError('GET /api/qr/status', error)

  return NextResponse.json({ used: !data || data.used_at !== null })
}
