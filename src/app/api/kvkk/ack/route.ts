/**
 * GET  /api/kvkk/ack — oturumdaki çalışanın aydınlatma metni onay durumu
 * POST /api/kvkk/ack — "Okudum, bilgilendirildim" teyidi (güncel sürüm için)
 *
 * Bu bir RIZA değil, bilgilendirme teyididir (bkz. @/lib/kvkk). Kiosk hesabı hariç her çalışan
 * yalnızca kendi kaydını günceller; işlem denetim kaydına yazılır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'
import { badRequest, readJson, serverError, tooManyRequests } from '@/lib/apiErrors'
import { checkRateLimit } from '@/lib/rateLimiter'
import { logAudit } from '@/lib/auditLog'
import { KVKK_NOTICE_VERSION, type KvkkAckStatus } from '@/lib/kvkk'

const ACK_RATE_LIMIT = 10
const ACK_RATE_WINDOW_MS = 60 * 1000

function status(row: { kvkk_notice_ack_at: string | null; kvkk_notice_version: string | null } | null): KvkkAckStatus {
  return {
    version: KVKK_NOTICE_VERSION,
    acknowledged: !!row?.kvkk_notice_ack_at && row.kvkk_notice_version === KVKK_NOTICE_VERSION,
    acknowledged_at: row?.kvkk_notice_ack_at ?? null,
    acknowledged_version: row?.kvkk_notice_version ?? null,
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  try {
    const { data, error } = await createAdminClient()
      .from('employees')
      .select('kvkk_notice_ack_at, kvkk_notice_version')
      .eq('id', auth.employee.id)
      .maybeSingle()
    if (error) return serverError('GET /api/kvkk/ack', error)
    return NextResponse.json(status(data))
  } catch (err) {
    return serverError('GET /api/kvkk/ack', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  try {
    const rate = await checkRateLimit(`kvkk_ack:${employee.id}`, ACK_RATE_LIMIT, ACK_RATE_WINDOW_MS)
    if (!rate.allowed) return tooManyRequests()

    const body = await readJson<{ version?: unknown }>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')
    if (body.version !== KVKK_NOTICE_VERSION) {
      return badRequest('Aydınlatma metni güncellenmiş. Sayfayı yenileyip güncel metni okuyun.', 'NOTICE_VERSION_MISMATCH')
    }

    const admin = createAdminClient()
    const { data: before, error: readError } = await admin
      .from('employees')
      .select('kvkk_notice_ack_at, kvkk_notice_version')
      .eq('id', employee.id)
      .maybeSingle()
    if (readError) return serverError('POST /api/kvkk/ack', readError)

    const at = new Date().toISOString()
    const { error } = await admin
      .from('employees')
      .update({ kvkk_notice_ack_at: at, kvkk_notice_version: KVKK_NOTICE_VERSION })
      .eq('id', employee.id)
    if (error) return serverError('POST /api/kvkk/ack', error)

    await logAudit({
      actorId: employee.id,
      storeId: employee.store_id,
      action: 'kvkk.notice_ack',
      entityType: 'employee',
      entityId: employee.id,
      before,
      after: { kvkk_notice_ack_at: at, kvkk_notice_version: KVKK_NOTICE_VERSION },
    })

    return NextResponse.json(status({ kvkk_notice_ack_at: at, kvkk_notice_version: KVKK_NOTICE_VERSION }))
  } catch (err) {
    return serverError('POST /api/kvkk/ack', err)
  }
}
