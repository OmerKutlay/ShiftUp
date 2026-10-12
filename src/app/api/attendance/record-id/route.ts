/**
 * GET /api/attendance/record-id?employee_id=xxx&work_date=YYYY-MM-DD
 * Çalışanın belirli bir tarihteki attendance kaydının ID'sini döner.
 * Manuel override için kullanılır — FAZ 7.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const employeeId = searchParams.get('employee_id')
  const workDate = searchParams.get('work_date')

  if (!employeeId || !workDate) {
    return NextResponse.json(
      { error: 'employee_id ve work_date gereklidir.', code: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  // work_date format doğrulama
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return NextResponse.json(
      { error: 'work_date YYYY-MM-DD formatında olmalıdır.', code: 'VALIDATION_ERROR' },
      { status: 400 }
    )
  }

  try {
    const admin = createAdminClient()

    // Önce shift_assignment bul
    const { data: shifts, error: shiftError } = await admin
      .from('shift_assignments')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('work_date', workDate)
      .limit(1)

    if (shiftError) {
      return NextResponse.json({ error: 'Vardiya sorgulanamadı.', code: 'DB_ERROR' }, { status: 500 })
    }

    if (!shifts || shifts.length === 0) {
      return NextResponse.json({ error: 'Bu tarihte vardiya bulunamadı.', code: 'NOT_FOUND' }, { status: 404 })
    }

    const shiftId = shifts[0].id

    // Attendance kaydını bul
    const { data: record, error: recError } = await admin
      .from('attendance_records')
      .select('id, status')
      .eq('shift_assignment_id', shiftId)
      .maybeSingle()

    if (recError) {
      return NextResponse.json({ error: 'Kayıt sorgulanamadı.', code: 'DB_ERROR' }, { status: 500 })
    }

    if (!record) {
      return NextResponse.json({ error: 'Attendance kaydı bulunamadı.', code: 'NOT_FOUND' }, { status: 404 })
    }

    return NextResponse.json({ record_id: record.id, status: record.status })
  } catch (err) {
    console.error('[GET /api/attendance/record-id]', err)
    return NextResponse.json({ error: 'Sunucu hatası.', code: 'UNKNOWN' }, { status: 500 })
  }
}
