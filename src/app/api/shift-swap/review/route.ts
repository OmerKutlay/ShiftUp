/**
 * POST /api/shift-swap/review
 * Body: { swap_id, status: 'approved'|'rejected'|'cancelled', reviewer_note? }
 * FAZ 11
 *
 * - approved / rejected: yalnızca Müdür Yardımcısı+ (takasın tarafı olmayan bir yönetici)
 * - cancelled: yalnızca talebi açan çalışan (kendi bekleyen talebini geri çeker)
 *
 * Vardiyalar YALNIZCA onay durumunda değişir. Reddedilen, iptal edilen veya
 * bekleyen talepler shift_assignments'a dokunmaz.
 * Onayda: hedef vardiya varsa iki vardiya karşılıklı değişir; yoksa talep
 * edenin vardiyası hedef çalışana devredilir.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { createNotification } from '@/lib/notificationRepository'
import { requireAuth, roleAtLeast, forbidden, ROLES } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const body = (await req.json()) as {
      swap_id?: string
      status?: string
      reviewer_note?: string | null
    }

    if (!body.swap_id) return NextResponse.json({ error: 'swap_id zorunludur.' }, { status: 400 })
    if (!['approved', 'rejected', 'cancelled'].includes(body.status ?? ''))
      return NextResponse.json({ error: "status 'approved', 'rejected' veya 'cancelled' olmalıdır." }, { status: 400 })

    const admin = createAdminClient()

    const { data: swap } = await admin
      .from('shift_swap_requests')
      .select('*')
      .eq('id', body.swap_id)
      .maybeSingle()

    if (!swap) return NextResponse.json({ error: 'Takas talebi bulunamadı.' }, { status: 404 })

    // ── Yetki ──────────────────────────────────────────────────
    if (body.status === 'cancelled') {
      if (swap.requester_id !== currentEmployee.id)
        return forbidden('Yalnızca talebi oluşturan çalışan iptal edebilir.')
    } else {
      if (!currentEmployee.role_name || !roleAtLeast(currentEmployee.role_name, ROLES.MUDUR_YARDIMCISI))
        return forbidden('Takas talebini yalnızca yöneticiler onaylayabilir veya reddedebilir.')
      if (swap.requester_id === currentEmployee.id || swap.target_id === currentEmployee.id)
        return forbidden('Tarafı olduğunuz bir takas talebini onaylayamaz veya reddedemezsiniz.')
    }

    if (swap.status !== 'pending')
      return NextResponse.json({ error: `Bu talep zaten ${swap.status}.` }, { status: 409 })

    // ── Onay öncesi: vardiyalar hâlâ talep anındaki sahiplerinde mi? ──
    if (body.status === 'approved') {
      if (!swap.target_id)
        return NextResponse.json({ error: 'Hedef çalışanı olmayan talep onaylanamaz.' }, { status: 400 })

      const ids = [swap.requester_shift_id, swap.target_shift_id].filter(Boolean) as string[]
      const { data: shifts } = await admin
        .from('shift_assignments')
        .select('id, employee_id')
        .in('id', ids)

      const owner = new Map((shifts ?? []).map((s) => [s.id, s.employee_id]))
      const stale =
        owner.get(swap.requester_shift_id) !== swap.requester_id ||
        (swap.target_shift_id && owner.get(swap.target_shift_id) !== swap.target_id)

      if (stale)
        return NextResponse.json({
          error: 'Vardiyalar talep oluşturulduktan sonra değişmiş. Talebi reddedip yeniden oluşturun.',
        }, { status: 409 })
    }

    // ── Talebi atomik olarak sahiplen (yalnızca hâlâ pending ise) ──
    const now = new Date().toISOString()
    const { data: updated, error: updateErr } = await admin
      .from('shift_swap_requests')
      .update({
        status: body.status,
        reviewer_note: body.reviewer_note?.trim() || null,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', body.swap_id)
      .eq('status', 'pending')
      .select()
      .maybeSingle()

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
    if (!updated) return NextResponse.json({ error: 'Bu talep başka biri tarafından işlendi.' }, { status: 409 })

    // ── Onaylandıysa gerçek takası uygula ─────────────────────────
    if (body.status === 'approved') {
      const { error: err1 } = await admin
        .from('shift_assignments')
        .update({ employee_id: swap.target_id })
        .eq('id', swap.requester_shift_id)
        .eq('employee_id', swap.requester_id)

      let err2 = null
      if (!err1 && swap.target_shift_id) {
        const res = await admin
          .from('shift_assignments')
          .update({ employee_id: swap.requester_id })
          .eq('id', swap.target_shift_id)
          .eq('employee_id', swap.target_id)
        err2 = res.error
      }

      if (err1 || err2) {
        // Yarım kalan takası geri al
        if (!err1) {
          await admin
            .from('shift_assignments')
            .update({ employee_id: swap.requester_id })
            .eq('id', swap.requester_shift_id)
        }
        await admin
          .from('shift_swap_requests')
          .update({ status: 'pending', reviewer_note: null, reviewed_at: null, updated_at: now })
          .eq('id', body.swap_id)
        return NextResponse.json({ error: 'Takas uygulanamadı. Lütfen tekrar deneyin.' }, { status: 500 })
      }
    }

    // ── Bildirimler ──────────────────────────────────────────────
    if (body.status !== 'cancelled') {
      const isApproved = body.status === 'approved'
      const note = updated.reviewer_note ? ` Not: ${updated.reviewer_note}` : ''
      const recipients = isApproved ? [swap.requester_id, swap.target_id] : [swap.requester_id]
      for (const employeeId of recipients) {
        try {
          await createNotification(admin, {
            employee_id: employeeId,
            type: isApproved ? 'shift_swap_approved' : 'shift_swap_rejected',
            title: isApproved ? 'Vardiya takası onaylandı' : 'Vardiya takası reddedildi',
            message: isApproved
              ? `Vardiya takası yönetici tarafından onaylandı, planınız güncellendi.${note}`
              : `Vardiya takas talebiniz reddedildi, vardiyanız değişmedi.${note}`,
            related_id: swap.id,
          })
        } catch (notifErr) {
          console.error('[POST /api/shift-swap/review] bildirim gönderilemedi:', notifErr)
        }
      }
    }

    return NextResponse.json({ swap_request: updated })
  } catch (err) {
    console.error('[POST /api/shift-swap/review]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
