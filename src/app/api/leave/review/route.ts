/**
 * POST /api/leave/review
 * Yönetici tarafından izin talebi onaylama/reddetme.
 *
 * Body: { request_id, status: 'approved'|'rejected', reviewer_note? }
 *
 * - Yönetici kendi talebini onaylayamaz (ikinci bir yönetici gerekir).
 * - Güncelleme yalnızca hâlâ 'pending' ise uygulanır (eşzamanlı çift onay engeli).
 * - Onayda o aralığın planlanmış vardiyaları kaldırılır; çalışılmış vardiyalar korunur.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { createNotification } from '@/lib/notificationRepository'
import { requireMinRole, ACCESS, forbidden, forbidIfOutranked } from '@/lib/auth'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { removePlannedShiftsInRange } from '@/lib/leaveService'
import { logAudit } from '@/lib/auditLog'
import { isEmployeeInStore } from '@/lib/storeScope'

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  try {
    const body = await readJson<{ request_id?: string; status?: string; reviewer_note?: string | null }>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')
    if (!isUuid(body.request_id)) return badRequest('request_id zorunludur.')
    if (body.status !== 'approved' && body.status !== 'rejected') {
      return badRequest("status 'approved' veya 'rejected' olmalıdır.")
    }
    if (body.reviewer_note && (typeof body.reviewer_note !== 'string' || body.reviewer_note.length > 500)) {
      return badRequest('Not en fazla 500 karakter olabilir.')
    }

    const admin = createAdminClient()

    const { data: existing, error: exErr } = await admin
      .from('leave_requests')
      .select('id, employee_id, status')
      .eq('id', body.request_id)
      .maybeSingle()
    if (exErr) return serverError('POST /api/leave/review', exErr)
    // Başka mağazanın talebi görünmez (404)
    if (!existing || !(await isEmployeeInStore(existing.employee_id, auth.employee.store_id))) {
      return notFound('İzin talebi bulunamadı.')
    }

    if (existing.employee_id === auth.employee.id) {
      return forbidden('Kendi izin talebinizi onaylayamaz veya reddedemezsiniz.')
    }
    const outranked = await forbidIfOutranked(auth.employee, existing.employee_id)
    if (outranked) return outranked
    if (existing.status !== 'pending') {
      return conflict(`Bu talep zaten ${existing.status === 'approved' ? 'onaylanmış' : 'reddedilmiş'}.`, 'ALREADY_REVIEWED')
    }

    const now = new Date().toISOString()
    const { data, error } = await admin
      .from('leave_requests')
      .update({
        status: body.status,
        reviewer_note: body.reviewer_note?.trim() || null,
        reviewed_at: now,
        reviewed_by: auth.employee.id,
        updated_at: now,
      })
      .eq('id', body.request_id)
      .eq('status', 'pending')
      .select()
      .maybeSingle()

    if (error) return serverError('POST /api/leave/review', error)
    if (!data) return conflict('Bu talep az önce başka bir yönetici tarafından incelendi.', 'ALREADY_REVIEWED')

    let cleanup = { removed: 0, keptWorked: 0 }
    if (body.status === 'approved') {
      try {
        cleanup = await removePlannedShiftsInRange(admin, data.employee_id, data.start_date, data.end_date)
      } catch (cleanupErr) {
        console.error('[POST /api/leave/review] vardiya temizliği başarısız:', cleanupErr)
      }
    }

    await logAudit({
      actorId: auth.employee.id,
      storeId: auth.employee.store_id,
      action: `leave.${body.status}`,
      entityType: 'leave_request',
      entityId: data.id,
      before: { status: 'pending' },
      after: { status: body.status, reviewer_note: data.reviewer_note, ...cleanup },
    })

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

    return NextResponse.json({ request: data, kept_worked_shifts: cleanup.keptWorked })
  } catch (err) {
    return serverError('POST /api/leave/review', err)
  }
}
