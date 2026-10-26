/**
 * GET /api/kvkk/acknowledgements — aktif mağazadaki aktif çalışanların aydınlatma onay durumu
 * (Mağaza Müdürü+, Ayarlar › KVKK). Yalnızca ad + onaylanan sürüm/tarih döner; e-posta gibi
 * ek kişisel veri gönderilmez.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { NOT_KIOSK_FILTER } from '@/lib/auth/roles'
import { serverError } from '@/lib/apiErrors'
import { KVKK_NOTICE_VERSION, type KvkkAckRow } from '@/lib/kvkk'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
  if ('response' in auth) return auth.response

  try {
    const { data, error } = await createAdminClient()
      .from('employees')
      .select('id, full_name, kvkk_notice_ack_at, kvkk_notice_version')
      .eq('store_id', auth.employee.store_id)
      .eq('active', true)
      .or(NOT_KIOSK_FILTER)
      .order('full_name', { ascending: true })
    if (error) return serverError('GET /api/kvkk/acknowledgements', error)
    return NextResponse.json({ version: KVKK_NOTICE_VERSION, employees: (data ?? []) as KvkkAckRow[] })
  } catch (err) {
    return serverError('GET /api/kvkk/acknowledgements', err)
  }
}
