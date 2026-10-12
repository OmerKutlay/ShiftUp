/**
 * GET /api/reports/timesheet?month=YYYY-MM[&format=xlsx]
 * Aylık puantaj — çalışan × gün kodları, net saat, fazla çalışma, gece çalışması,
 * resmi tatil çalışması, izinler, SGK prim günü. Müdür Yardımcısı+.
 * format=xlsx → Excel dosyası indirir; aksi halde JSON.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ROLES } from '@/lib/auth'
import { badRequest, serverError } from '@/lib/apiErrors'
import { queryTimesheet } from '@/lib/timesheetQuery'
import { buildTimesheetWorkbook } from '@/lib/timesheetExcel'
import { logAudit } from '@/lib/auditLog'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
  if ('response' in auth) return auth.response

  const month = req.nextUrl.searchParams.get('month') ?? ''
  if (!MONTH_RE.test(month)) return badRequest('month YYYY-MM formatında olmalıdır.')
  const format = req.nextUrl.searchParams.get('format')

  try {
    const { rows, holidays } = await queryTimesheet(createAdminClient(), month)

    if (format === 'xlsx') {
      const buffer = await buildTimesheetWorkbook(month, rows, holidays)
      await logAudit({ actorId: auth.employee.id, action: 'report.timesheet.export', entityType: 'report', entityId: month })
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="puantaj-${month}.xlsx"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json({ month, rows, holidays })
  } catch (err) {
    return serverError('GET /api/reports/timesheet', err)
  }
}
