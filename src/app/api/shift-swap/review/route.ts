/**
 * POST /api/shift-swap/review
 * Body: { swap_id, status: 'approved'|'rejected'|'cancelled', reviewer_note? }
 * Onaylanırsa shift_assignments güncellenir (gerçek takas).
 * FAZ 11
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'

export async function POST(req: NextRequest) {
  // Takas onayı manager+ yetkisi gerektirir
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  try {
    const body = (await req.json()) as {
      swap_id?: string
      status?: string
      reviewer_note?: string | null
    }

    if (!body.swap_id) return NextResponse.json({ error: 'swap_id zorunludur.' }, { status: 400 })
    if (!['approved','rejected','cancelled'].includes(body.status ?? ''))
      return NextResponse.json({ error: "status 'approved', 'rejected' veya 'cancelled' olmalıdır." }, { status: 400 })

    const admin = createAdminClient()

    const { data: swap } = await admin
      .from('shift_swap_requests')
      .select('*')
      .eq('id', body.swap_id)
      .maybeSingle()

    if (!swap) return NextResponse.json({ error: 'Takas talebi bulunamadı.' }, { status: 404 })
    if (swap.status !== 'pending')
      return NextResponse.json({ error: `Bu talep zaten ${swap.status}.` }, { status: 409 })

    // Güncelle
    const { data: updated, error: updateErr } = await admin
      .from('shift_swap_requests')
      .update({
        status: body.status,
        reviewer_note: body.reviewer_note ?? null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.swap_id)
      .select()
      .single()

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    // Onaylandıysa ve her iki taraf da shift_id varsa, gerçek takas yap
    if (body.status === 'approved' && swap.target_shift_id && swap.target_id) {
      // requester_shift → target_id, target_shift → requester_id
      const { error: swapErr1 } = await admin
        .from('shift_assignments')
        .update({ employee_id: swap.target_id })
        .eq('id', swap.requester_shift_id)

      const { error: swapErr2 } = await admin
        .from('shift_assignments')
        .update({ employee_id: swap.requester_id })
        .eq('id', swap.target_shift_id)

      if (swapErr1 || swapErr2) {
        // Takas başarısız, geri al
        await admin
          .from('shift_swap_requests')
          .update({ status: 'pending', reviewed_at: null })
          .eq('id', body.swap_id)
        return NextResponse.json({ error: 'Takas uygulanamadı. Lütfen tekrar deneyin.' }, { status: 500 })
      }
    }

    return NextResponse.json({ swap_request: updated })
  } catch (err) {
    console.error('[POST /api/shift-swap/review]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
