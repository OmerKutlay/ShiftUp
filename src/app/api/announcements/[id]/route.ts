/**
 * GET    /api/announcements/[id] — Duyuru detayı (yönetici için alıcı listesi: ad + okundu/onay)
 * PATCH  /api/announcements/[id] — Başlık / metin / sabitleme / bitiş düzenle (Yönetici+)
 * DELETE /api/announcements/[id] — Duyuruyu sil (soft delete, audit log)
 *
 * GET: yalnızca alıcı ya da yöneticisi; erişimi olmayana (başka mağaza dahil) 404.
 * PATCH/DELETE: aktif mağazanın duyurusu (şirket geneli → yalnızca Admin) ve kendinden yüksek
 * yetkili birinin duyurusu değilse. Düzenleme okundu/onay kayıtlarını SIFIRLAMAZ ve yeniden
 * bildirim göndermez: alıcı anlık görüntüsü ve istatistikler sabit kalır; hatırlatma ayrı bir işlemdir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth, forbidden, forbidIfOutranked } from '@/lib/auth'
import { badRequest, notFound, readJson, serverError } from '@/lib/apiErrors'
import { logAudit } from '@/lib/auditLog'
import { isUuid } from '@/lib/validation'
import { parseAnnouncementInput } from '@/lib/announcementValidation'
import { canManage, getAnnouncementForActor, inScope, loadAnnouncement } from '@/lib/announcementService'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { id } = await params
  if (!isUuid(id)) return notFound('Duyuru bulunamadı.')

  try {
    const result = await getAnnouncementForActor(createAdminClient(), auth.employee, id)
    if (!result) return notFound('Duyuru bulunamadı.')
    return NextResponse.json(result)
  } catch (err) {
    return serverError('GET /api/announcements/[id]', err)
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth
  const { id } = await params
  if (!isUuid(id)) return notFound('Duyuru bulunamadı.')

  const raw = await readJson(req)
  if (!raw) return badRequest('Geçersiz istek gövdesi.')
  const parsed = parseAnnouncementInput(raw, { create: false })
  if (!parsed.ok) return badRequest(parsed.error)
  const { title, body, pinned, expires_at } = parsed.value
  const patch = Object.fromEntries(
    Object.entries({ title, body, pinned, expires_at }).filter(([, v]) => v !== undefined),
  )
  if (Object.keys(patch).length === 0) return badRequest('Değiştirilecek alan yok.')

  try {
    const admin = createAdminClient()
    const row = await loadAnnouncement(admin, id)
    if (!row || !inScope(employee, row)) return notFound('Duyuru bulunamadı.')
    if (!canManage(employee, row)) return forbidden('Bu duyuruyu düzenleme yetkiniz yok.')
    const denied = await forbidIfOutranked(employee, row.created_by)
    if (denied) return denied

    const { error } = await admin.from('announcements').update(patch).eq('id', id).is('deleted_at', null)
    if (error) throw error

    await logAudit({
      actorId: employee.id,
      storeId: employee.store_id,
      action: 'announcement.update',
      entityType: 'announcement',
      entityId: id,
      before: { title: row.title, body: row.body, pinned: row.pinned, expires_at: row.expires_at },
      after: patch,
    })
    const result = await getAnnouncementForActor(admin, employee, id)
    return NextResponse.json(result ?? { announcement: null })
  } catch (err) {
    return serverError('PATCH /api/announcements/[id]', err)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee } = auth
  const { id } = await params
  if (!isUuid(id)) return notFound('Duyuru bulunamadı.')

  try {
    const admin = createAdminClient()
    const row = await loadAnnouncement(admin, id)
    if (!row || !inScope(employee, row)) return notFound('Duyuru bulunamadı.')
    if (!canManage(employee, row)) return forbidden('Bu duyuruyu silme yetkiniz yok.')
    const denied = await forbidIfOutranked(employee, row.created_by)
    if (denied) return denied

    const { error } = await admin
      .from('announcements')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
    if (error) throw error

    await logAudit({
      actorId: employee.id,
      storeId: employee.store_id,
      action: 'announcement.delete',
      entityType: 'announcement',
      entityId: id,
      before: { title: row.title, store_id: row.store_id },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return serverError('DELETE /api/announcements/[id]', err)
  }
}
