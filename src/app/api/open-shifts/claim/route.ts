/**
 * POST /api/open-shifts/claim
 * FAZ 11 + FAZ AUTH-2
 *
 * Authenticated employee kendi adına open shift claim eder.
 * Body'deki employee_id SESSION'DAN alınır — client'tan gelen değere güvenilmez.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/auth'
import { validateShiftAssignment } from '@/lib/workingTimeService'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns'
import type { DayOfWeek } from '@/types/workforce'

export async function POST(req: NextRequest) {
  // Authentication zorunlu
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response
  const { employee: currentEmployee } = auth

  try {
    const body = (await req.json()) as { open_shift_id?: string; employee_id?: string }
    if (!body.open_shift_id)
      return NextResponse.json({ error: 'open_shift_id zorunludur.' }, { status: 400 })

    // employee_id: session'dan al, client değerini yoksay
    // (Client body'de employee_id göndermiş olsa bile session'daki ID kullanılır)
    const claimingEmployeeId = currentEmployee.id

    const admin = createAdminClient()

    // Açık vardiyayı doğrula
    const { data: openShift } = await admin
      .from('open_shifts')
      .select('id, status, work_date, start_time, end_time')
      .eq('id', body.open_shift_id)
      .maybeSingle()

    if (!openShift)
      return NextResponse.json({ error: 'Açık vardiya bulunamadı.' }, { status: 404 })
    if (openShift.status !== 'open')
      return NextResponse.json({ error: 'Bu vardiya artık açık değil.' }, { status: 409 })

    // Çakışma kontrolü (gece yarısını geçen vardiyalar dahil)
    const { data: conflicts } = await admin
      .from('shift_assignments')
      .select('id, work_date, start_time, end_time')
      .eq('employee_id', claimingEmployeeId)
      .gte('work_date', format(addDays(new Date(openShift.work_date), -1), 'yyyy-MM-dd'))
      .lte('work_date', format(addDays(new Date(openShift.work_date), 1), 'yyyy-MM-dd'))

    if (conflicts && conflicts.length > 0) {
      const toMins = (t: string) => {
        const [h, m] = t.slice(0, 5).split(':').map(Number)
        return h * 60 + m
      }
      const newStart = toMins(openShift.start_time)
      let newEnd = toMins(openShift.end_time)
      if (newEnd <= newStart) newEnd += 24 * 60
      const hasConflict = conflicts
        .filter((c) => c.work_date === openShift.work_date)
        .some((c) => {
          const cS = toMins(c.start_time)
          let cE = toMins(c.end_time)
          if (cE <= cS) cE += 24 * 60
          return newStart < cE && cS < newEnd
        })
      if (hasConflict) {
        return NextResponse.json(
          { error: 'Bu tarihte çakışan bir vardiya mevcut.' },
          { status: 409 },
        )
      }
    }

    // Çalışma süresi kuralları kontrolü
    const config = getWorkingTimeConfig()
    const dateObj = new Date(openShift.work_date)
    const weekStart = format(startOfWeek(dateObj, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const weekEnd = format(endOfWeek(dateObj, { weekStartsOn: 1 }), 'yyyy-MM-dd')

    const existingShifts = ((conflicts ?? []) as Array<{ id: string; work_date: string; start_time: string; end_time: string }>)

    const { data: availRaw } = await admin
      .from('employee_availability')
      .select('day_of_week, start_time, end_time, is_available')
      .eq('employee_id', claimingEmployeeId)

    const wtResult = validateShiftAssignment({
      newDate: openShift.work_date,
      newStart: openShift.start_time,
      newEnd: openShift.end_time,
      existingShifts,
      weekStart,
      weekEnd,
      config,
      availability: (availRaw ?? []) as Array<{ day_of_week: DayOfWeek; start_time: string; end_time: string; is_available: boolean }>,
    })

    if (!wtResult.valid) {
      return NextResponse.json(
        { error: wtResult.errors.map((e) => e.message).join(' '), code: 'WORKING_TIME_VIOLATION' },
        { status: 422 },
      )
    }

    // shift_assignments'a ekle
    const { data: newAssignment, error: assignErr } = await admin
      .from('shift_assignments')
      .insert({
        employee_id:       claimingEmployeeId,
        shift_template_id: null,
        work_date:         openShift.work_date,
        start_time:        openShift.start_time,
        end_time:          openShift.end_time,
      })
      .select('id')
      .single()

    if (assignErr)
      return NextResponse.json({ error: assignErr.message }, { status: 500 })

    // open_shifts → filled
    const { data: updatedOpenShift, error: updateErr } = await admin
      .from('open_shifts')
      .update({
        status:     'filled',
        filled_by:  claimingEmployeeId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.open_shift_id)
      .select()
      .single()

    if (updateErr) {
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
