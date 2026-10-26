/**
 * POST /api/time-correction/review
 * Yönetici bekleyen mesai talebini onaylar veya reddeder. Yetki: en az Müdür Yardımcısı.
 *
 * Body: { request_id, status: 'approved'|'rejected', reviewer_note?, acknowledge_violations? }
 *
 * - Yönetici kendi talebini inceleyemez.
 * - Onayda çalışma süresi ihlali varsa acknowledge_violations=true olmadan 422 döner.
 * - Durum geçişi atomiktir (yalnızca 'pending' → karar); uygulama başarısız olursa
 *   talep tekrar 'pending' yapılır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS, forbidden, forbidIfOutranked } from '@/lib/auth'
import { createNotification } from '@/lib/notificationRepository'
import { applyTimeCorrection, checkCorrectionViolations, CrossStoreShiftError } from '@/lib/timeCorrectionService'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { logAudit } from '@/lib/auditLog'
import { employeeStoreId } from '@/lib/storeScope'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response
  const { employee: reviewer } = auth

  try {
    const body = await readJson<{
      request_id?: string
      status?: string
      reviewer_note?: string | null
      acknowledge_violations?: boolean
    }>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')
    if (!isUuid(body.request_id)) return badRequest('request_id zorunludur.')
    if (body.status !== 'approved' && body.status !== 'rejected') {
      return badRequest("status 'approved' veya 'rejected' olmalıdır.")
    }
    if (body.reviewer_note && (typeof body.reviewer_note !== 'string' || body.reviewer_note.length > 500)) {
      return badRequest('Not en fazla 500 karakter olabilir.')
    }

    const admin = createAdminClient()

    const { data: request, error: reqErr } = await admin
      .from('manual_time_correction_requests')
      .select('id, status, employee_id, date, requested_start_time, requested_end_time, reason')
      .eq('id', body.request_id)
      .maybeSingle()
    if (reqErr) return serverError('POST /api/time-correction/review', reqErr)
    if (!request) return notFound('Talep bulunamadı.')

    // Başka mağazanın talebi görünmez (404)
    const storeId = await employeeStoreId(request.employee_id)
    if (!storeId || storeId !== reviewer.store_id) return notFound('Talep bulunamadı.')

    if (request.employee_id === reviewer.id) {
      return forbidden('Kendi mesai düzeltme talebinizi inceleyemezsiniz.')
    }
    const outranked = await forbidIfOutranked(reviewer, request.employee_id)
    if (outranked) return outranked
    if (request.status !== 'pending') {
      return conflict(`Bu talep zaten ${request.status === 'approved' ? 'onaylanmış' : 'reddedilmiş'}.`, 'ALREADY_REVIEWED')
    }

    const start = String(request.requested_start_time).slice(0, 5)
    const end = String(request.requested_end_time).slice(0, 5)

    // Onay öncesi ihlal kontrolü
    let violationMessages: string[] = []
    if (body.status === 'approved') {
      const v = await checkCorrectionViolations({
        admin, employeeId: request.employee_id, storeId, date: request.date, startTime: start, endTime: end,
      })
      if (v.otherStoreShift) return conflict(new CrossStoreShiftError().message, 'SHIFT_IN_OTHER_STORE')
      violationMessages = v.errors.map((x) => x.message)
      if (violationMessages.length > 0 && body.acknowledge_violations !== true) {
        return NextResponse.json(
          {
            error: 'Bu düzeltme çalışma süresi kurallarını ihlal ediyor. Onaylıyorsanız tekrar gönderin.',
            code: 'WORKING_TIME_VIOLATION',
            violations: violationMessages,
          },
          { status: 422 }
        )
      }
    }

    // Atomik durum geçişi: yalnızca hâlâ pending ise
    const now = new Date().toISOString()
    const { data: updated, error: updateErr } = await admin
      .from('manual_time_correction_requests')
      .update({
        status: body.status,
        reviewed_by: reviewer.id,
        reviewed_at: now,
        reviewer_note: body.reviewer_note?.trim() || null,
        updated_at: now,
      })
      .eq('id', body.request_id)
      .eq('status', 'pending')
      .select()
      .maybeSingle()
    if (updateErr) return serverError('POST /api/time-correction/review', updateErr)
    if (!updated) return conflict('Bu talep az önce başka bir yönetici tarafından incelendi.', 'ALREADY_REVIEWED')

    if (body.status === 'approved') {
      try {
        const applied = await applyTimeCorrection({
          admin,
          employeeId: request.employee_id,
          storeId,
          date: request.date,
          startTime: start,
          endTime: end,
        })
        await logAudit({
          actorId: reviewer.id,
          storeId,
          action: 'time_correction.approved',
          entityType: 'attendance_record',
          entityId: applied.attendanceRecordId,
          after: { request_id: request.id, date: request.date, start, end, break_minutes: applied.breakMinutes },
          note: violationMessages.length > 0 ? `İhlaller onaylandı: ${violationMessages.join(' | ')}` : null,
        })
      } catch (applyErr) {
        await admin
          .from('manual_time_correction_requests')
          .update({ status: 'pending', reviewed_by: null, reviewed_at: null, updated_at: new Date().toISOString() })
          .eq('id', request.id)
        return serverError('POST /api/time-correction/review apply', applyErr)
      }
    } else {
      await logAudit({
        actorId: reviewer.id,
        storeId,
        action: 'time_correction.rejected',
        entityType: 'time_correction_request',
        entityId: request.id,
        note: body.reviewer_note ?? null,
      })
    }

    try {
      const isApproved = body.status === 'approved'
      const label = format(new Date(`${request.date}T12:00:00`), 'd MMMM yyyy', { locale: tr })
      await createNotification(admin, {
        employee_id: request.employee_id,
        type: isApproved ? 'time_correction_approved' : 'time_correction_rejected',
        title: isApproved ? 'Mesai düzeltme talebiniz onaylandı' : 'Mesai düzeltme talebiniz reddedildi',
        message: isApproved
          ? `${label} ${start}–${end} mesai düzeltme talebiniz onaylandı, kayıtlarınız güncellendi.`
          : `${label} mesai düzeltme talebiniz reddedildi.${body.reviewer_note ? ' Not: ' + body.reviewer_note : ''}`,
        related_id: request.id,
      })
    } catch (notifErr) {
      console.error('[time-correction/review] bildirim gönderilemedi:', notifErr)
    }

    return NextResponse.json({ request: updated, warnings: violationMessages })
  } catch (err) {
    return serverError('POST /api/time-correction/review', err)
  }
}
