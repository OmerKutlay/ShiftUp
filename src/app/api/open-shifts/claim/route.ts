/**
 * POST /api/open-shifts/claim
 * Body: { open_shift_id, employee_id }
 *
 * Çalışan açık vardiyayı üstlenir:
 *   1. open_shifts → status: filled, filled_by: employee_id
 *   2. shift_assignments → yeni kayıt eklenir (Weekly Schedule'da görünmesi için)
 *
 * FAZ 11
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { open_shift_id?: string; employee_id?: string }
    if (!body.open_shift_id)
      return NextResponse.json({ error: 'open_shift_id zorunludur.' }, { status: 400 })
    if (!body.employee_id)
      return NextResponse.json({ error: 'employee_id zorunludur.' }, { status: 400 })

    const admin = createAdminClient()

    // Açık vardiyayı doğrula — work_date/start_time/end_time de gerekli
    const { data: openShift } = await admin
      .from('open_shifts')
      .select('id, status, work_date, start_time, end_time')
      .eq('id', body.open_shift_id)
      .maybeSingle()

    if (!openShift)
      return NextResponse.json({ error: 'Açık vardiya bulunamadı.' }, { status: 404 })
    if (openShift.status !== 'open')
      return NextResponse.json({ error: 'Bu vardiya artık açık değil.' }, { status: 409 })

    // Çalışanın bu gün+saat için çakışan shift_assignment'ı var mı?
    const { data: conflicts } = await admin
      .from('shift_assignments')
      .select('id, start_time, end_time')
      .eq('employee_id', body.employee_id)
      .eq('work_date', openShift.work_date)

    if (conflicts && conflicts.length > 0) {
      // Basit çakışma kontrolü
      const toMins = (t: string) => {
        const [h, m] = t.slice(0, 5).split(':').map(Number)
        return h * 60 + m
      }
      const newStart = toMins(openShift.start_time)
      const newEnd   = toMins(openShift.end_time)
      const hasConflict = conflicts.some((c) => {
        const cS = toMins(c.start_time)
        const cE = toMins(c.end_time)
        return newStart < cE && cS < newEnd
      })
      if (hasConflict) {
        return NextResponse.json(
          { error: 'Bu tarihte çakışan bir vardiya mevcut.' },
          { status: 409 },
        )
      }
    }

    // 1. shift_assignments'a ekle (Weekly Schedule buradan okur)
    const { data: newAssignment, error: assignErr } = await admin
      .from('shift_assignments')
      .insert({
        employee_id:       body.employee_id,
        shift_template_id: null,               // open shift — template'siz
        work_date:         openShift.work_date,
        start_time:        openShift.start_time,
        end_time:          openShift.end_time,
      })
      .select('id')
      .single()

    if (assignErr)
      return NextResponse.json({ error: assignErr.message }, { status: 500 })

    // 2. open_shifts → filled
    const { data: updatedOpenShift, error: updateErr } = await admin
      .from('open_shifts')
      .update({
        status:     'filled',
        filled_by:  body.employee_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.open_shift_id)
      .select()
      .single()

    if (updateErr) {
      // open_shift güncellenemedi — shift_assignment'ı geri al
      await admin.from('shift_assignments').delete().eq('id', newAssignment.id)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({
      open_shift:          updatedOpenShift,
      shift_assignment_id: newAssignment.id,
    })
  } catch (err) {
    console.error('[POST /api/open-shifts/claim]', err)
    return NextResponse.json({ error: 'Sunucu hatası.' }, { status: 500 })
  }
}
