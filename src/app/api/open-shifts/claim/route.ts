/**
 * POST /api/open-shifts/claim
 * Body: { open_shift_id, employee_id }
 * Çalışan açık vardiyayı üstlenir → status: filled, filled_by: employee_id
 * FAZ 11
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { open_shift_id?: string; employee_id?: string }
    if (!body.open_shift_id) return NextResponse.json({ error: 'open_shift_id zorunludur.' }, { status: 400 })
    if (!body.employee_id) return NextResponse.json({ error: 'employee_id zorunludur.' }, { status: 400 })

    const admin = createAdminClient()

    // Açık vardiyayı doğrula
    const { data: shift } = await admin
      .from('open_shifts')
      .select('id, status')
      .eq('id', body.open_shift_id)
      .maybeSingle()

    if (!shift) return NextResponse.json({ error: 'Açık vardiya bulunamadı.' }, { status: 404 })
    if (shift.status !== 'open')
      return NextResponse.json({ error: 'Bu vardiya artık açık değil.' }, { status: 409 })

    const { data, error } = await admin
      .from('open_shifts')
      .update({ status: 'filled', filled_by: body.employee_id, updated_at: new Date().toISOString() })
      .eq('id', body.open_shift_id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ open_shift: data })
  } catch (err) {
    console.error('[POST /api/open-shifts/claim]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
