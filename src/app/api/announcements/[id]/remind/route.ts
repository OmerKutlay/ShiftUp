/**
 * POST /api/announcements/[id]/remind — Okumayanlara (onay zorunluysa onaylamayanlara) hatırlat
 *
 * Yönetici+ (şirket geneli → Admin). Yalnızca henüz okumayan/onaylamayan alıcılara bildirim gider.
 * Aynı duyuru için en fazla 6 saatte bir: son hatırlatma zamanı ÖNCE koşullu (atomik) güncellemeyle
 * alınır, sonra hedefler okunur — eşzamanlı iki istek çift bildirim üretemez. Hedef yoksa ya da
 * gönderim başarısız olursa zaman, yalnızca hâlâ bizim değerimizse (koşullu) eski haline döner;
 * böylece hata sonrası yönetici 6 saat beklemek zorunda kalmaz. Süresi dolmuş duyuru hatırlatılmaz.
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
    const denied = row.created_by ? await forbidIfOutranked(employee, row.created_by) : null
    if (denied) return denied
    if (isExpired(row)) return badRequest('Süresi dolmuş duyuru hatırlatılamaz.')

    const now = Date.now()
    const throttled = () => tooManyRequests('Bu duyuru için en fazla 6 saatte bir hatırlatma gönderilebilir.')
    if (row.last_reminded_at && now - new Date(row.last_reminded_at).getTime() < REMIND_INTERVAL_MS) return throttled()
    // Kullanıcı başına genel sınır (çok sayıda duyuruyu arka arkaya hatırlatmayı önler)
    const limit = await checkRateLimit(`announcement_remind:${employee.id}`, 20, 24 * 60 * 60 * 1000)
    if (!limit.allowed) return tooManyRequests('Bugün için hatırlatma sınırına ulaştınız.')

    // 1) Atomik talep: aralık dolmadıysa (başka istek az önce hatırlatmışsa) hiçbir satır güncellenmez
    const claimedValue = new Date(now).toISOString()
    const cutoff = new Date(now - REMIND_INTERVAL_MS).toISOString()
    const { data: claimed, error } = await admin
      .from('announcements')
      .update({ last_reminded_at: claimedValue })
      .eq('id', id)
      .is('deleted_at', null)
      .or(`last_reminded_at.is.null,last_reminded_at.lt.${cutoff}`)
      .select('id')
    if (error) throw error
    if (!claimed || claimed.length === 0) return throttled()

    // Talep sonrası hata / hedef yok: yalnızca bizim yazdığımız değer duruyorsa eskisine döndür
    const revert = async () => {
      const { error: revErr } = await admin
        .from('announcements')
        .update({ last_reminded_at: row.last_reminded_at })
        .eq('id', id)
        .eq('last_reminded_at', claimedValue)
      if (revErr) console.error('[remind] last_reminded_at geri alınamadı', revErr.message)
    }

    // 2) Hedefler talepten SONRA okunur
    let targets: string[]
    try {
      targets = await pendingRecipientIds(admin, row)
    } catch (err) {
      await revert()
      throw err
    }
    if (targets.length === 0) {
      await revert()
      return badRequest(row.requires_ack ? 'Herkes duyuruyu onayladı.' : 'Herkes duyuruyu okudu.')
    }

    let notified: number
    try {
      notified = await notifyRecipients(admin, row, targets, { reminder: true, needsAck: row.requires_ack })
    } catch (err) {
      await revert()
      throw err
    }
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
