/**
 * GET  /api/shift-swap?employee_id=xxx&status=pending
 * POST /api/shift-swap
 * FAZ 11 + FAZ AUTH-2
 *
 * GET:  requireAuth → employee kendi swap'larını görür; manager+ herkes
 * POST: requireAuth → requester_id SESSION'dan alınır
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateSwapRequestPayload } from '@/types/workforce'
import { requireAuth, MANAGER_ROLES } from '@/lib/auth'

// ─── GET ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    const isManager = currentEmployee.role_name
      ? MANAGER_ROLES.includes(currentEmployee.role_name)
      : false

    const admin = createAdminClient()
    let query = admin
      .from('shift_swap_requests')
      .select(`
        *,
        requester:employees!requester_id(id, full_name),
        target:employees!target_id(id, full_name),
        requester_shift:shift_assignments!requester_shift_id(work_date, start_time, end_time),
        target_shift:shift_assignments!target_shift_id(work_date, start_time, end_time)
      `)
      .order('created_at', { ascending: false })

    if (status) query = query.eq('status', status)

    // Manager+ tümünü görür; çalışan yalnızca kendi taleplerini
    if (!isManager) {
      query = query.or(`requester_id.eq.${currentEmployee.id},target_id.eq.${currentEmployee.id}`)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ swap_requests: data ?? [] })
  } catch (err) {
    console.error('[GET /api/shift-swap]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

// ─── POST ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const body = (await req.json()) as Partial<CreateSwapRequestPayload>

    // requester_id SESSION'dan alınır — client değeri yoksayılır
    const requesterId = currentEmployee.id

    if (!body.requester_shift_id)
      return NextResponse.json({ error: 'requester_shift_id zorunludur.' }, { status: 400 })

    const admin = createAdminClient()

    // Shift gerçekten bu employee'a ait mi?
    const { data: shift } = await admin
      .from('shift_assignments')
      .select('id, employee_id')
      .eq('id', body.requester_shift_id)
      .maybeSingle()

    if (!shift) return NextResponse.json({ error: 'Vardiya bulunamadı.' }, { status: 404 })
    if (shift.employee_id !== requesterId)
      return NextResponse.json({ error: 'Bu vardiya size ait değil.' }, { status: 403 })

    // Bekleyen talep kontrolü
    const { data: existing } = await admin
      .from('shift_swap_requests')
      .select('id')
      .eq('requester_shift_id', body.requester_shift_id)
      .eq('status', 'pending')
      .limit(1)

    if (existing && existing.length > 0)
      return NextResponse.json({ error: 'Bu vardiya için zaten bekleyen bir takas talebi var.' }, { status: 409 })

    const { data, error } = await admin
      .from('shift_swap_requests')
      .insert({
        requester_id:       requesterId,
        requester_shift_id: body.requester_shift_id,
        target_id:          body.target_id ?? null,
        target_shift_id:    body.target_shift_id ?? null,
        requester_note:     body.requester_note ?? null,
        status: 'pending',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ swap_request: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/shift-swap]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
