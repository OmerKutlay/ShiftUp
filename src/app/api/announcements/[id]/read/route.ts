/**
 * POST /api/announcements/[id]/read — Duyuruyu okundu işaretle
 *
 * Yalnızca alıcının kendisi için (employee_id oturumdan). İdempotent: ilk okuma zamanı korunur.
 * Alıcı olmayana / başka mağazanın duyurusuna 404.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'
import { notFound, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { inScope, loadAnnouncement, markReadOrAck } from '@/lib/announcementService'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth
  const { id } = await params
  if (!isUuid(id)) return notFound('Duyuru bulunamadı.')

  try {
    const admin = createAdminClient()
    const row = await loadAnnouncement(admin, id)
    if (!row || !inScope(employee, row)) return notFound('Duyuru bulunamadı.')
    const mine = await markReadOrAck(admin, id, employee.id, 'read')
    if (!mine) return notFound('Duyuru bulunamadı.')
    return NextResponse.json({ read_at: mine.read_at, ack_at: mine.ack_at })
  } catch (err) {
    return serverError('POST /api/announcements/[id]/read', err)
  }
}
