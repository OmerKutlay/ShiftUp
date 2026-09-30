/**
 * GET  /api/open-shifts?status=open|filled|cancelled&date=YYYY-MM-DD
 * POST /api/open-shifts
 * FAZ 11
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateOpenShiftPayload } from '@/types/workforce'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const date = searchParams.get('date')

    const admin = createAdminClient()
    let query = admin
      .from('open_shifts')
      .select(`*, filled_by_employee:employees!filled_by(id, full_name)`)
      .order('work_date')
      .order('start_time')

    if (status) query = query.eq('status', status)
    if (date) query = query.eq('work_date', date)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ open_shifts: data ?? [] })
  } catch (err) {
    console.error('[GET /api/open-shifts]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CreateOpenShiftPayload>

    if (!body.work_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.work_date))
      return NextResponse.json({ error: 'Geçerli work_date zorunludur (YYYY-MM-DD).' }, { status: 400 })
    if (!body.start_time || !body.end_time)
      return NextResponse.json({ error: 'start_time ve end_time zorunludur.' }, { status: 400 })
    if (body.start_time >= body.end_time)
      return NextResponse.json({ error: 'Başlangıç saati bitiş saatinden önce olmalıdır.' }, { status: 400 })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('open_shifts')
      .insert({
        work_date: body.work_date,
        start_time: body.start_time,
        end_time: body.end_time,
        role_needed: body.role_needed ?? null,
        description: body.description ?? null,
        status: 'open',
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ open_shift: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/open-shifts]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id: string; status?: string; role_needed?: string; description?: string }
    if (!body.id) return NextResponse.json({ error: 'id zorunludur.' }, { status: 400 })

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = { updated_at: new Date().toISOString() }
    if (body.status) patch.status = body.status
    if (body.role_needed !== undefined) patch.role_needed = body.role_needed
    if (body.description !== undefined) patch.description = body.description

    const { data, error } = await admin.from('open_shifts').update(patch).eq('id', body.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ open_shift: data })
  } catch (err) {
    console.error('[PATCH /api/open-shifts]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
