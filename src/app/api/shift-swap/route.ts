/**
 * GET  /api/shift-swap?employee_id=xxx&status=pending
 * POST /api/shift-swap
 * FAZ 11
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateSwapRequestPayload } from '@/types/workforce'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employee_id')
    const status = searchParams.get('status')

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
    if (employeeId) {
      // hem talep sahibi hem hedef olarak filtrele
      query = query.or(`requester_id.eq.${employeeId},target_id.eq.${employeeId}`)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ swap_requests: data ?? [] })
  } catch (err) {
    console.error('[GET /api/shift-swap]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CreateSwapRequestPayload>

    if (!body.requester_id) return NextResponse.json({ error: 'requester_id zorunludur.' }, { status: 400 })
    if (!body.requester_shift_id) return NextResponse.json({ error: 'requester_shift_id zorunludur.' }, { status: 400 })

    const admin = createAdminClient()

    // Shift varlık kontrolü
    const { data: shift } = await admin
      .from('shift_assignments')
      .select('id, employee_id')
      .eq('id', body.requester_shift_id)
      .maybeSingle()

    if (!shift) return NextResponse.json({ error: 'Vardiya bulunamadı.' }, { status: 404 })
    if (shift.employee_id !== body.requester_id)
      return NextResponse.json({ error: 'Bu vardiya size ait değil.' }, { status: 403 })

    // Aynı vardiya için bekleyen talep var mı?
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
        requester_id: body.requester_id,
        requester_shift_id: body.requester_shift_id,
        target_id: body.target_id ?? null,
        target_shift_id: body.target_shift_id ?? null,
        requester_note: body.requester_note ?? null,
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
