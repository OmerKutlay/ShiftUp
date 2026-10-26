/**
 * GET  /api/announcements?archive=1 — Oturumdaki kişinin duyuruları (+ okunmamış sayısı)
 * POST /api/announcements           — Duyuru yayınla (Yönetici+; tüm mağazalara yalnızca Admin)
 *
 * GET: çalışan yalnızca alıcısı olduğu duyuruları görür; yönetici ek olarak aktif mağazasının
 * duyurularını okundu/onay istatistiğiyle görür. Varsayılan liste süresi dolmamışları, archive=1
 * yalnızca süresi dolanları döner.
 * POST: alıcılar yayın anında dondurulur (aktif, kiosk olmayan çalışanlar; hedef rol filtresi),
 * her alıcıya tek toplu insert ile 'announcement' bildirimi gider. Kullanıcı başına günde 20 yayın.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth, forbidden } from '@/lib/auth'
import { badRequest, readJson, serverError, tooManyRequests } from '@/lib/apiErrors'
import { checkRateLimit } from '@/lib/rateLimiter'
import { logAudit } from '@/lib/auditLog'
import { parseAnnouncementInput } from '@/lib/announcementValidation'
import {
  ANNOUNCEMENT_COLUMNS, CREATE_RATE_LIMIT, CREATE_RATE_WINDOW_MS, canPublish, countUnread, insertRecipients,
  listAnnouncements, notifyRecipients, resolveRecipients, type AnnouncementRow,
} from '@/lib/announcementService'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  try {
    const admin = createAdminClient()
    const archive = req.nextUrl.searchParams.get('archive') === '1'
    const [announcements, unread_count] = await Promise.all([
      listAnnouncements(admin, employee, { archive }),
      countUnread(admin, employee),
    ])
    return NextResponse.json({ announcements, unread_count })
  } catch (err) {
    return serverError('GET /api/announcements', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const raw = await readJson(req)
  if (!raw) return badRequest('Geçersiz istek gövdesi.')
  const parsed = parseAnnouncementInput(raw, { create: true })
  if (!parsed.ok) return badRequest(parsed.error)
  const input = parsed.value
  const companyWide = input.all_stores === true

  if (!canPublish(employee, companyWide)) {
    return forbidden(
      companyWide ? 'Tüm mağazalara yalnızca Admin duyuru yayınlayabilir.' : 'Duyuru yayınlamak için yönetici yetkisi gerekir.',
    )
  }

  const limit = await checkRateLimit(`announcement_create:${employee.id}`, CREATE_RATE_LIMIT, CREATE_RATE_WINDOW_MS)
  if (!limit.allowed) return tooManyRequests('Bugün için duyuru yayın sınırına ulaştınız. Yarın tekrar deneyin.')

  try {
    const admin = createAdminClient()
    const storeId = companyWide ? null : employee.store_id
    const targetRoles = input.target_roles ?? 'all'

    const { data, error } = await admin
      .from('announcements')
      .insert({
        store_id: storeId,
        title: input.title,
        body: input.body,
        pinned: input.pinned ?? false,
        requires_ack: input.requires_ack ?? false,
        target_roles: targetRoles,
        expires_at: input.expires_at ?? null,
        created_by: employee.id,
      })
      .select(ANNOUNCEMENT_COLUMNS)
      .single()
    if (error) throw error
    const row = data as AnnouncementRow

    let recipientIds: string[]
    try {
      recipientIds = await resolveRecipients(admin, { storeId, targetRoles, excludeId: employee.id })
      await insertRecipients(admin, row.id, recipientIds)
    } catch (err) {
      // Alıcısız yarım duyuru kalmasın
      await admin.from('announcements').delete().eq('id', row.id)
      throw err
    }

    let notified = 0
    try {
      notified = await notifyRecipients(admin, row, recipientIds)
    } catch (err) {
      // Duyuru yayında; bildirim hatası yayını geri almaz
      console.error('[POST /api/announcements] bildirim', err)
    }

    await logAudit({
      actorId: employee.id,
      storeId: employee.store_id,
      action: 'announcement.create',
      entityType: 'announcement',
      entityId: row.id,
      after: {
        title: row.title, store_id: storeId, target_roles: targetRoles,
        requires_ack: row.requires_ack, recipients: recipientIds.length,
      },
    })

    return NextResponse.json({ announcement: { id: row.id }, recipients: recipientIds.length, notified }, { status: 201 })
  } catch (err) {
    return serverError('POST /api/announcements', err)
  }
}
