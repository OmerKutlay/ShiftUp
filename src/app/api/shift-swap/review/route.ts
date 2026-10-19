/**
 * POST /api/shift-swap/review
 * Body: { swap_id, status, reviewer_note?, acknowledge_violations? }
 *
 *   status = 'accepted'  → yalnızca HEDEF çalışan; teklifi kabul eder (yönetici onayına gider)
 *   status = 'declined'  → yalnızca HEDEF çalışan; teklifi reddeder (talep 'rejected' olur)
 *   status = 'cancelled' → yalnızca talebi açan çalışan; bekleyen talebi geri çeker
 *   status = 'approved' / 'rejected' → Müdür Yardımcısı+ (takasın tarafı olmayan)
 *
 * Onay koşulları: hedef çalışan kabul etmiş olmalı; vardiyalar hâlâ aynı sahiplerde
 * olmalı; hiçbirinde devam kaydı (giriş) olmamalı; iki taraf için de çakışma/izin
 * olmamalı. Çalışma süresi ihlalleri yalnızca acknowledge_violations=true ile aşılır.
 * Takas uygulanırken her güncellemenin etkilediği satır doğrulanır; yarım kalan
 * takas geri alınır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { createNotification, notifyManagers } from '@/lib/notificationRepository'
import { requireAuth, roleAtLeast, forbidden, ACCESS } from '@/lib/auth'
import { badRequest, conflict, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isUuid } from '@/lib/validation'
import { checkAssignmentRules, shiftsHaveAttendance } from '@/lib/shiftAssignmentRules'
import { logAudit } from '@/lib/auditLog'

type Action = 'accepted' | 'declined' | 'cancelled' | 'approved' | 'rejected'
const ACTIONS: Action[] = ['accepted', 'declined', 'cancelled', 'approved', 'rejected']

interface ShiftRow { id: string; employee_id: string; work_date: string; start_time: string; end_time: string }

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const body = await readJson<{
      swap_id?: string
      status?: string
      reviewer_note?: string | null
      acknowledge_violations?: boolean
    }>(req)
    if (!body) return badRequest('Geçersiz istek gövdesi.')
    if (!isUuid(body.swap_id)) return badRequest('swap_id zorunludur.')
    if (!ACTIONS.includes(body.status as Action)) return badRequest('Geçersiz işlem.')
    if (body.reviewer_note && (typeof body.reviewer_note !== 'string' || body.reviewer_note.length > 500)) {
      return badRequest('Not en fazla 500 karakter olabilir.')
    }
    const action = body.status as Action

    const admin = createAdminClient()

    const { data: swap, error: swapErr } = await admin
      .from('shift_swap_requests')
      .select('*')
      .eq('id', body.swap_id)
      .maybeSingle()
    if (swapErr) return serverError('POST /api/shift-swap/review', swapErr)
    if (!swap) return notFound('Takas talebi bulunamadı.')
    if (swap.status !== 'pending') return conflict(`Bu talep zaten ${swap.status}.`)

    const now = new Date().toISOString()

    // ── Hedef çalışanın kabul / reddi ─────────────────────────
    if (action === 'accepted' || action === 'declined') {
      if (swap.target_id !== currentEmployee.id) {
        return forbidden('Yalnızca teklif yapılan çalışan kabul veya reddedebilir.')
      }
      if (action === 'accepted' && swap.target_accepted_at) return conflict('Teklifi zaten kabul ettiniz.')

      const patch = action === 'accepted'
        ? { target_accepted_at: now, updated_at: now }
        : { status: 'rejected', reviewer_note: 'Karşı taraf teklifi reddetti.', reviewed_at: now, updated_at: now }

      const { data: updated, error } = await admin
        .from('shift_swap_requests')
        .update(patch)
        .eq('id', swap.id)
        .eq('status', 'pending')
        .select()
        .maybeSingle()
      if (error) return serverError('POST /api/shift-swap/review', error)
      if (!updated) return conflict('Bu talep az önce güncellendi.')

      try {
        if (action === 'accepted') {
          await notifyManagers(
            admin,
            {
              type: 'shift_swap_submitted',
              title: 'Vardiya takası onay bekliyor',
              message: `${currentEmployee.full_name} takas teklifini kabul etti. Onayınız bekleniyor.`,
              related_id: swap.id,
            },
            { excludeEmployeeId: swap.requester_id },
          )
        }
        await createNotification(admin, {
          employee_id: swap.requester_id,
          type: action === 'accepted' ? 'shift_swap_submitted' : 'shift_swap_rejected',
          title: action === 'accepted' ? 'Takas teklifiniz kabul edildi' : 'Takas teklifiniz reddedildi',
          message: action === 'accepted'
            ? `${currentEmployee.full_name} teklifinizi kabul etti; talep yönetici onayına gönderildi.`
            : `${currentEmployee.full_name} takas teklifinizi reddetti. Vardiyanız değişmedi.`,
          related_id: swap.id,
        })
      } catch (notifErr) {
        console.error('[POST /api/shift-swap/review] bildirim gönderilemedi:', notifErr)
      }
      return NextResponse.json({ swap_request: updated })
    }

    // ── Talep edenin iptali ────────────────────────────────────
    if (action === 'cancelled') {
      if (swap.requester_id !== currentEmployee.id) return forbidden('Yalnızca talebi oluşturan çalışan iptal edebilir.')
      const { data: updated, error } = await admin
        .from('shift_swap_requests')
        .update({ status: 'cancelled', reviewed_at: now, updated_at: now })
        .eq('id', swap.id)
        .eq('status', 'pending')
        .select()
        .maybeSingle()
      if (error) return serverError('POST /api/shift-swap/review', error)
      if (!updated) return conflict('Bu talep az önce güncellendi.')
      return NextResponse.json({ swap_request: updated })
    }

    // ── Yönetici kararı ────────────────────────────────────────
    if (!roleAtLeast(currentEmployee.access_level, ACCESS.MANAGER)) {
      return forbidden('Takas talebini yalnızca yöneticiler onaylayabilir veya reddedebilir.')
    }
    if (swap.requester_id === currentEmployee.id || swap.target_id === currentEmployee.id) {
      return forbidden('Tarafı olduğunuz bir takas talebini onaylayamaz veya reddedemezsiniz.')
    }

    let violationMessages: string[] = []
    if (action === 'approved') {
      if (!swap.target_id) return badRequest('Hedef çalışanı olmayan talep onaylanamaz.')
      if (!swap.target_accepted_at) return conflict('Karşı taraf teklifi henüz kabul etmedi.', 'TARGET_NOT_ACCEPTED')

      const ids = [swap.requester_shift_id, swap.target_shift_id].filter(Boolean) as string[]
      const { data: shifts, error: shErr } = await admin
        .from('shift_assignments')
        .select('id, employee_id, work_date, start_time, end_time')
        .in('id', ids)
      if (shErr) return serverError('POST /api/shift-swap/review', shErr)

      const byId = new Map(((shifts ?? []) as ShiftRow[]).map((s) => [s.id, s]))
      const reqShift = byId.get(swap.requester_shift_id)
      const tgtShift = swap.target_shift_id ? byId.get(swap.target_shift_id) : null
      if (
        !reqShift || reqShift.employee_id !== swap.requester_id ||
        (swap.target_shift_id && (!tgtShift || tgtShift.employee_id !== swap.target_id))
      ) {
        return conflict('Vardiyalar talep oluşturulduktan sonra değişmiş. Talebi reddedip yeniden oluşturun.')
      }
      if (await shiftsHaveAttendance(admin, ids)) {
        return conflict('Başlamış (giriş yapılmış) bir vardiya takas edilemez.', 'SHIFT_STARTED')
      }

      // İki taraf için kural kontrolü — el değiştiren vardiyalar hesaba katılmaz
      const checks = await Promise.all([
        checkAssignmentRules(admin, swap.target_id, reqShift, ids),
        tgtShift ? checkAssignmentRules(admin, swap.requester_id, tgtShift, ids) : null,
      ])
      const blockers = checks.flatMap((c) => c?.blockers ?? [])
      if (blockers.length > 0) {
        return NextResponse.json({ error: blockers.join(' '), code: 'SWAP_BLOCKED', violations: blockers }, { status: 409 })
      }
      violationMessages = checks.flatMap((c) => c?.violations.map((v) => v.message) ?? [])
      if (violationMessages.length > 0 && body.acknowledge_violations !== true) {
        return NextResponse.json(
          {
            error: 'Takas çalışma süresi kurallarını ihlal ediyor. Onaylıyorsanız tekrar gönderin.',
            code: 'WORKING_TIME_VIOLATION',
            violations: violationMessages,
          },
          { status: 422 }
        )
      }
    }

    // Talebi atomik olarak sahiplen (yalnızca hâlâ pending ise)
    const { data: updated, error: updateErr } = await admin
      .from('shift_swap_requests')
      .update({
        status: action,
        reviewer_note: body.reviewer_note?.trim() || null,
        reviewed_at: now,
        reviewed_by: currentEmployee.id,
        updated_at: now,
      })
      .eq('id', swap.id)
      .eq('status', 'pending')
      .select()
      .maybeSingle()
    if (updateErr) return serverError('POST /api/shift-swap/review', updateErr)
    if (!updated) return conflict('Bu talep başka biri tarafından işlendi.')

    if (action === 'approved') {
      const revertRequest = () =>
        admin
          .from('shift_swap_requests')
          .update({ status: 'pending', reviewer_note: null, reviewed_at: null, reviewed_by: null, updated_at: now })
          .eq('id', swap.id)

      const { data: moved1, error: err1 } = await admin
        .from('shift_assignments')
        .update({ employee_id: swap.target_id })
        .eq('id', swap.requester_shift_id)
        .eq('employee_id', swap.requester_id)
        .select('id')

      if (err1 || !moved1 || moved1.length !== 1) {
        await revertRequest()
        return serverError('POST /api/shift-swap/review', err1 ?? 'requester shift değişmedi', 'Takas uygulanamadı. Lütfen tekrar deneyin.')
      }

      if (swap.target_shift_id) {
        const { data: moved2, error: err2 } = await admin
          .from('shift_assignments')
          .update({ employee_id: swap.requester_id })
          .eq('id', swap.target_shift_id)
          .eq('employee_id', swap.target_id)
          .select('id')

        if (err2 || !moved2 || moved2.length !== 1) {
          // Yarım kalan takası geri al
          await admin
            .from('shift_assignments')
            .update({ employee_id: swap.requester_id })
            .eq('id', swap.requester_shift_id)
          await revertRequest()
          return serverError('POST /api/shift-swap/review', err2 ?? 'target shift değişmedi', 'Takas uygulanamadı. Lütfen tekrar deneyin.')
        }
      }
    }

    await logAudit({
      actorId: currentEmployee.id,
      action: `shift_swap.${action}`,
      entityType: 'shift_swap_request',
      entityId: swap.id,
      after: { requester_shift_id: swap.requester_shift_id, target_shift_id: swap.target_shift_id },
      note: violationMessages.length > 0 ? `İhlaller onaylandı: ${violationMessages.join(' | ')}` : null,
    })

    const isApproved = action === 'approved'
    const note = updated.reviewer_note ? ` Not: ${updated.reviewer_note}` : ''
    const recipients = [swap.requester_id, swap.target_id].filter(Boolean) as string[]
    for (const employeeId of recipients) {
      try {
        await createNotification(admin, {
          employee_id: employeeId,
          type: isApproved ? 'shift_swap_approved' : 'shift_swap_rejected',
          title: isApproved ? 'Vardiya takası onaylandı' : 'Vardiya takası reddedildi',
          message: isApproved
            ? `Vardiya takası yönetici tarafından onaylandı, planınız güncellendi.${note}`
            : `Vardiya takas talebi reddedildi, vardiyalar değişmedi.${note}`,
          related_id: swap.id,
        })
      } catch (notifErr) {
        console.error('[POST /api/shift-swap/review] bildirim gönderilemedi:', notifErr)
      }
    }

    return NextResponse.json({ swap_request: updated, warnings: violationMessages })
  } catch (err) {
    return serverError('POST /api/shift-swap/review', err)
  }
}
