/**
 * POST /api/time-correction/review
 * Yönetici bekleyen mesai talebini onaylar veya reddeder.
 * Yetki: en az Müdür Yardımcısı.
 *
 * Onay → applyTimeCorrection() → shift_assignment + attendance_record
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { createNotification } from '@/lib/notificationRepository'
import { applyTimeCorrection } from '@/lib/timeCorrectionService'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response
  const { employee: reviewer } = auth

  try {
    const body = (await req.json()) as {
      request_id?: string
      status?: string
      reviewer_note?: string | null
    }

    if (!body.request_id || typeof body.request_id !== 'string') {
      return NextResponse.json({ error: 'request_id zorunludur.', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (body.status !== 'approved' && body.status !== 'rejected') {
      return NextResponse.json({ error: "status 'approved' veya 'rejected' olmalıdır.", code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: req_ } = await admin
      .from('manual_time_correction_requests')
      .select('id, status, employee_id, date, requested_start_time, requested_end_time, reason')
      .eq('id', body.request_id)
      .maybeSingle()

    if (!req_) return NextResponse.json({ error: 'Talep bulunamadı.', code: 'NOT_FOUND' }, { status: 404 })
    if (req_.status !== 'pending') {
      return NextResponse.json({
        error: `Bu talep zaten ${req_.status === 'approved' ? 'onaylanmış' : 'reddedilmiş'}.`,
        code: 'ALREADY_REVIEWED',
      }, { status: 409 })
    }

    const { data: updated, error: updateErr } = await admin
      .from('manual_time_correction_requests')
      .update({
        status: body.status,
        reviewed_by: reviewer.id,
        reviewed_at: new Date().toISOString(),
        reviewer_note: body.reviewer_note?.trim() ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.request_id)
      .select()
      .single()

    if (updateErr) return NextResponse.json({ error: updateErr.message, code: 'DB_ERROR' }, { status: 500 })

    // Onay → shift_assignment + attendance_record uygula
    const warnings: string[] = []
    if (body.status === 'approved') {
      const result = await applyTimeCorrection({
        admin,
        employeeId: req_.employee_id,
        date: req_.date,
        startTime: req_.requested_start_time.slice(0, 5),
        endTime:   req_.requested_end_time.slice(0, 5),
      })
      warnings.push(...result.warnings)
    }

    // Çalışana bildirim
    try {
      const isApproved = body.status === 'approved'
      const dateLabel  = format(new Date(req_.date + 'T00:00:00'), 'd MMMM yyyy', { locale: tr })
      await createNotification(admin, {
        employee_id: req_.employee_id,
        type: isApproved ? 'time_correction_approved' : 'time_correction_rejected',
        title: isApproved ? 'Mesai düzeltme talebiniz onaylandı' : 'Mesai düzeltme talebiniz reddedildi',
        message: isApproved
          ? `${dateLabel} ${req_.requested_start_time.slice(0, 5)}–${req_.requested_end_time.slice(0, 5)} mesai düzeltme talebiniz onaylandı, takviminiz güncellendi.`
          : `${dateLabel} mesai düzeltme talebiniz reddedildi.${body.reviewer_note ? ' Not: ' + body.reviewer_note : ''}`,
        related_id: body.request_id,
      })
    } catch (notifErr) {
      console.error('[time-correction/review] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ request: updated, warnings })
  } catch (err) {
    console.error('[POST /api/time-correction/review]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
