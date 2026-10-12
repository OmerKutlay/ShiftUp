/**
 * POST /api/leave/review
 * Manager tarafından izin talebi onaylama/reddetme — FAZ 9 + FAZ 10 (bildirim) + FAZ 12 (is_on_leave).
 *
 * Body: { request_id, status: 'approved'|'rejected', reviewer_note? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { createNotification } from '@/lib/notificationRepository'
import { requireMinRole, ROLES } from '@/lib/auth'

export async function POST(req: NextRequest) {
  // Authorization: en az Müdür Yardımcısı yetkisi gerekir
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const body = await req.json() as {
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

    // Kaydın varlığını ve mevcut durumunu doğrula
    const { data: existing } = await admin
      .from('leave_requests')
      .select('id, status')
      .eq('id', body.request_id)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'İzin talebi bulunamadı.', code: 'NOT_FOUND' }, { status: 404 })
    }
    if (existing.status !== 'pending') {
      return NextResponse.json({
        error: `Bu talep zaten ${existing.status === 'approved' ? 'onaylanmış' : 'reddedilmiş'}.`,
        code: 'ALREADY_REVIEWED',
      }, { status: 409 })
    }

    const { data, error } = await admin
      .from('leave_requests')
      .update({
        status: body.status,
        reviewer_note: body.reviewer_note?.trim() ?? null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.request_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message, code: 'DB_ERROR' }, { status: 500 })
    }

    // FAZ 10: Onay/red sonrası çalışana bildirim gönder
    try {
      const isApproved = body.status === 'approved'
      await createNotification(admin, {
        employee_id: data.employee_id,
        type: isApproved ? 'leave_approved' : 'leave_rejected',
        title: isApproved ? 'İzin talebiniz onaylandı' : 'İzin talebiniz reddedildi',
        message: isApproved
          ? `${data.start_date} – ${data.end_date} tarihli izin talebiniz onaylandı.`
          : `${data.start_date} – ${data.end_date} tarihli izin talebiniz reddedildi.${data.reviewer_note ? ' Not: ' + data.reviewer_note : ''}`,
        related_id: data.id,
      })
    } catch (notifErr) {
      console.error('[POST /api/leave/review] bildirim gönderilemedi:', notifErr)
    }

    // İzin onaylandığında çakışan vardiyaları tamamen sil.
    // İzinli çalışana o günler için yeni vardiya da atanamaz (scheduleRepository guard'ı).
    if (body.status === 'approved') {
      const { error: deleteShiftsErr } = await admin
        .from('shift_assignments')
        .delete()
        .eq('employee_id', data.employee_id)
        .gte('work_date', data.start_date)
        .lte('work_date', data.end_date)
      if (deleteShiftsErr) {
        console.error('[POST /api/leave/review] çakışan vardiyalar silinemedi:', deleteShiftsErr.message)
      }
    }

    return NextResponse.json({ request: data })
  } catch (err) {
    console.error('[POST /api/leave/review]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
