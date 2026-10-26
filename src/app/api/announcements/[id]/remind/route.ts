/**
 * POST /api/announcements/[id]/remind — Okumayanlara (onay zorunluysa onaylamayanlara) hatırlat
 *
 * Yönetici+ (şirket geneli → Admin). Yalnızca henüz okumayan/onaylamayan alıcılara bildirim gider.
 * Aynı duyuru için en fazla 6 saatte bir: son hatırlatma zamanı koşullu (atomik) güncellemeyle
 * alınır, böylece eşzamanlı iki istek çift bildirim üretemez. Süresi dolmuş duyuru hatırlatılmaz.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth, forbidden, forbidIfOutranked } from '@/lib/auth'
import { badRequest, notFound, serverError, tooManyRequests } from '@/lib/apiErrors'
import { checkRateLimit } from '@/lib/rateLimiter'
import { logAudit } from '@/lib/auditLog'
import { isUuid } from '@/lib/validation'
import {
  REMIND_INTERVAL_MS, canManage, inScope, isExpired, loadAnnouncement, notifyRecipients, pendingRecipientIds,
} from '@/lib/announcementService'

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
    if (!canManage(employee, row)) return forbidden('Bu duyuruyu hatırlatma yetkiniz yok.')
    const denied = await forbidIfOutranked(employee, row.created_by)
    if (denied) return denied
    if (isExpired(row)) return badRequest('Süresi dolmuş duyuru hatırlatılamaz.')

    const now = Date.now()
    if (row.last_reminded_at && now - new Date(row.last_reminded_at).getTime() < REMIND_INTERVAL_MS) {
      return tooManyRequests('Bu duyuru için en fazla 6 saatte bir hatırlatma gönderilebilir.')
    }
    // Kullanıcı başına genel sınır (çok sayıda duyuruyu arka arkaya hatırlatmayı önler)
    const limit = await checkRateLimit(`announcement_remind:${employee.id}`, 20, 24 * 60 * 60 * 1000)
    if (!limit.allowed) return tooManyRequests('Bugün için hatırlatma sınırına ulaştınız.')

    const targets = await pendingRecipientIds(admin, row)
    if (targets.length === 0) return badRequest(row.requires_ack ? 'Herkes duyuruyu onayladı.' : 'Herkes duyuruyu okudu.')

    // Atomik talep: aralık dolmadıysa (başka istek az önce hatırlatmışsa) hiçbir satır güncellenmez
    const cutoff = new Date(now - REMIND_INTERVAL_MS).toISOString()
    const { data: claimed, error } = await admin
      .from('announcements')
      .update({ last_reminded_at: new Date(now).toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .or(`last_reminded_at.is.null,last_reminded_at.lt.${cutoff}`)
      .select('id')
    if (error) throw error
    if (!claimed || claimed.length === 0) {
      return tooManyRequests('Bu duyuru için en fazla 6 saatte bir hatırlatma gönderilebilir.')
    }

    const notified = await notifyRecipients(admin, row, targets, { reminder: true, needsAck: row.requires_ack })
    await logAudit({
      actorId: employee.id,
      storeId: employee.store_id,
      action: 'announcement.remind',
      entityType: 'announcement',
      entityId: id,
      after: { reminded: targets.length },
    })
    return NextResponse.json({ reminded: notified })
  } catch (err) {
    return serverError('POST /api/announcements/[id]/remind', err)
  }
}
