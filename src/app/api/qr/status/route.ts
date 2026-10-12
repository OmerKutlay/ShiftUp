/**
 * GET /api/qr/status?token=...
 *
 * Kiosk ekranı, gösterdiği QR'ın okutulup okutulmadığını bu endpoint ile yoklar.
 * Token kullanıldıysa kiosk hemen yeni QR üretir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ error: 'token zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('qr_tokens')
    .select('used_at')
    .eq('token', token)
    .maybeSingle()

  if (error) {
    console.error('[/api/qr/status]', error)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }

  return NextResponse.json({ used: !data || data.used_at !== null })
}
