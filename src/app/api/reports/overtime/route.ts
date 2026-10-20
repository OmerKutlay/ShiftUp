/**
 * GET /api/reports/overtime?year=YYYY
 * Yıllık fazla çalışma özeti (İş K. Md. 41): haftalık 45 saati aşan net çalışma,
 * yıllık 270 saat sınırına oran ve yazılı onay durumu. Müdür Yardımcısı+.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, serverError } from '@/lib/apiErrors'
import { overtimeYearRange, summarizeOvertime, type OvertimeShift } from '@/lib/overtime'
import type { AttendanceTimes } from '@/lib/attendanceDurations'
import { NOT_KIOSK_FILTER } from '@/lib/auth/roles'

const PAGE = 1000

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  const year = Number(req.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return badRequest('Geçerli bir yıl giriniz.')

  try {
    const admin = createAdminClient()
    const { from, to } = overtimeYearRange(year)

    const { data: employees, error: empErr } = await admin
      .from('employees')
      .select('id, full_name, overtime_consent_at, active')
      .or(NOT_KIOSK_FILTER)
      .order('full_name')
    if (empErr) return serverError('GET /api/reports/overtime', empErr)

    const shifts: OvertimeShift[] = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin
        .from('shift_assignments')
        .select('id, employee_id, work_date, attendance_records ( clock_in_at, clock_out_at, break_start_at, break_end_at, completed_break_minutes )')
        .gte('work_date', from)
        .lte('work_date', to)
        .order('id')
        .range(offset, offset + PAGE - 1)
      if (error) return serverError('GET /api/reports/overtime', error)
      for (const s of data ?? []) {
        const recs = s.attendance_records as unknown as AttendanceTimes[] | AttendanceTimes | null
        shifts.push({
          employee_id: s.employee_id as string,
          work_date: s.work_date as string,
          attendance: Array.isArray(recs) ? recs[0] ?? null : recs,
        })
      }
      if (!data || data.length < PAGE) break
    }

    const withData = new Set(shifts.filter((s) => s.attendance).map((s) => s.employee_id))
    const relevant = (employees ?? []).filter((e) => e.active || withData.has(e.id as string))
    const summaries = summarizeOvertime(year, relevant as Array<{ id: string; full_name: string; overtime_consent_at: string | null }>, shifts)

    return NextResponse.json({ year, summaries })
  } catch (err) {
    return serverError('GET /api/reports/overtime', err)
  }
}
