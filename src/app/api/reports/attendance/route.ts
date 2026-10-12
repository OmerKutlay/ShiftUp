/**
 * GET /api/reports/attendance?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD[&employee_id=xxx]
 *
 * Yönetici devam raporu — tüm çalışanların vardiya + attendance verileri.
 * En az Müdür Yardımcısı yetkisi gerekir; veri admin client ile okunur.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { validateReportFilters } from '@/lib/reportRepository'
import { queryAttendanceReport } from '@/lib/attendanceReportQuery'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  const { searchParams } = new URL(req.url)
  const filters = {
    date_from: searchParams.get('date_from') ?? '',
    date_to: searchParams.get('date_to') ?? '',
    employee_id: searchParams.get('employee_id') || undefined,
  }

  const validationError = validateReportFilters(filters)
  if (validationError) {
    return NextResponse.json({ error: validationError, code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  try {
    const rows = await queryAttendanceReport(createAdminClient(), filters)
    return NextResponse.json({ rows })
  } catch (err) {
    console.error('[GET /api/reports/attendance]', err)
    return NextResponse.json({ error: 'Rapor yüklenemedi.', code: 'DB_ERROR' }, { status: 500 })
  }
}
