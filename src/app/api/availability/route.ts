/**
 * GET  /api/availability?employee_id=xxx
 * POST /api/availability
 * DELETE /api/availability?id=xxx
 * FAZ 11
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import type { CreateAvailabilityPayload, DayOfWeek } from '@/types/workforce'

const VALID_DAYS: DayOfWeek[] = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employee_id')
    const admin = createAdminClient()

    let query = admin
      .from('employee_availability')
      .select('*')
      .order('day_of_week')
      .order('start_time')

    if (employeeId) query = query.eq('employee_id', employeeId)

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ availability: data ?? [] })
  } catch (err) {
    console.error('[GET /api/availability]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CreateAvailabilityPayload>

    if (!body.employee_id) return NextResponse.json({ error: 'employee_id zorunludur.' }, { status: 400 })
    if (!body.day_of_week || !VALID_DAYS.includes(body.day_of_week))
      return NextResponse.json({ error: 'Geçersiz gün.' }, { status: 400 })
    if (!body.start_time || !body.end_time)
      return NextResponse.json({ error: 'start_time ve end_time zorunludur.' }, { status: 400 })
    if (body.start_time >= body.end_time)
      return NextResponse.json({ error: 'Başlangıç saati bitiş saatinden önce olmalıdır.' }, { status: 400 })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('employee_availability')
      .insert({
        employee_id: body.employee_id,
        day_of_week: body.day_of_week,
        start_time: body.start_time,
        end_time: body.end_time,
        is_available: body.is_available ?? true,
        note: body.note ?? null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ availability: data }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/availability]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id zorunludur.' }, { status: 400 })

    const admin = createAdminClient()
    const { error } = await admin.from('employee_availability').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/availability]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
