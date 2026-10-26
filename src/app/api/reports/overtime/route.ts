/**
 * GET /api/reports/overtime?year=YYYY
 * Yıllık fazla çalışma özeti (İş K. Md. 41): haftalık 45 saati aşan net çalışma,
 * yıllık 270 saat sınırına oran ve yazılı onay durumu. Müdür Yardımcısı+.
 * Çalışan listesi: aktif mağazanın çalışanları + yıl içinde bu mağazada vardiyası olanlar.
 * Toplamlar çalışanın TÜM mağazalardaki vardiyalarından hesaplanır: haftalık 45 / yıllık 270 saat
 * sınırı işveren düzeyindedir ve mağazalar aynı işverendir (ay içinde mağaza değiştiren çalışanın
 * fazla çalışması bölünmez). Puantaj ise mağaza bazlıdır (reports/timesheet).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, serverError } from '@/lib/apiErrors'
import { overtimeYearRange, summarizeOvertime, type OvertimeShift } from '@/lib/overtime'
import type { AttendanceTimes } from '@/lib/attendanceDurations'
import { fetchStoreReportEmployees } from '@/lib/timesheetQuery'

const PAGE = 1000

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  const storeId = auth.employee.store_id
  const year = Number(req.nextUrl.searchParams.get('year'))
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return badRequest('Geçerli bir yıl giriniz.')

  try {
    const admin = createAdminClient()
    const { from, to } = overtimeYearRange(year)

    // 1) Yıl içinde bu mağazada devam kaydı olan çalışanlar (pasif / başka mağazaya geçmiş olanlar dahil)
    const withData = new Set<string>()
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin
        .from('shift_assignments')
        .select('id, employee_id, attendance_records ( id )')
        .eq('store_id', storeId)
        .gte('work_date', from)
        .lte('work_date', to)
        .order('id')
        .range(offset, offset + PAGE - 1)
      if (error) return serverError('GET /api/reports/overtime', error)
      for (const s of data ?? []) {
        const recs = s.attendance_records as unknown as unknown[] | unknown | null
        if (Array.isArray(recs) ? recs.length > 0 : recs) withData.add(s.employee_id as string)
      }
      if (!data || data.length < PAGE) break
    }

    // 2) Listelenecek çalışanlar: mağazanın aktif çalışanları + 1. adımdakiler
    const relevant = await fetchStoreReportEmployees<{ id: string; full_name: string; overtime_consent_at: string | null; active: boolean }>(
      admin, storeId, 'id, full_name, overtime_consent_at, active', withData
    )
    if (relevant.length === 0) return NextResponse.json({ year, summaries: [] })

    // 3) Bu çalışanların tüm mağazalardaki vardiyaları — yasal sınır çalışan başına toplamdır
    const shifts: OvertimeShift[] = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin
        .from('shift_assignments')
        .select('id, employee_id, work_date, start_time, end_time, attendance_records ( clock_in_at, clock_out_at, break_start_at, break_end_at, completed_break_minutes )')
        .in('employee_id', relevant.map((e) => e.id))
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
          start_time: s.start_time as string,
          end_time: s.end_time as string,
          attendance: Array.isArray(recs) ? recs[0] ?? null : recs,
        })
      }
      if (!data || data.length < PAGE) break
    }

    const summaries = summarizeOvertime(year, relevant, shifts)

    return NextResponse.json({ year, summaries })
  } catch (err) {
    return serverError('GET /api/reports/overtime', err)
  }
}
