/**
 * GET /api/reports/payroll?month=YYYY-MM[&format=xlsx|csv]
 * Bordro puantajı — muhasebeye verilecek aylık çalışan toplamları (çalışılan gün, normal/fazla mesai
 * saati, tatil/izin/rapor günleri, SGK prim günü, eksik gün nedeni kodu). Müdür Yardımcısı+ (timesheet ile aynı).
 * Yalnızca aktif mağazanın vardiyaları. Format yoksa JSON (ekran önizlemesi).
 * İndirmeler kişisel veri dışa aktarımıdır: kullanıcı başına hız sınırı + denetim kaydı.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, serverError, tooManyRequests } from '@/lib/apiErrors'
import { queryTimesheet } from '@/lib/timesheetQuery'
import { toPayrollRows, payrollToCsv } from '@/lib/payrollTimesheet'
import { buildPayrollWorkbook } from '@/lib/payrollExcel'
import { storeFileSlug } from '@/lib/timesheetExcel'
import { checkRateLimit } from '@/lib/rateLimiter'
import { logAudit } from '@/lib/auditLog'
import { turkeyToday } from '@/lib/dateUtils'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const EXPORT_LIMIT = 10
const EXPORT_WINDOW_MS = 10 * 60 * 1000

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response
  const storeId = auth.employee.store_id

  const month = req.nextUrl.searchParams.get('month') ?? ''
  if (!MONTH_RE.test(month)) return badRequest('month YYYY-MM formatında olmalıdır.')
  const format = req.nextUrl.searchParams.get('format')
  if (format !== null && format !== 'xlsx' && format !== 'csv') return badRequest('format xlsx veya csv olmalıdır.')

  try {
    if (format) {
      const rate = await checkRateLimit(`payroll_export:user:${auth.employee.id}`, EXPORT_LIMIT, EXPORT_WINDOW_MS)
      if (!rate.allowed) return tooManyRequests('Çok fazla indirme isteği. Lütfen birkaç dakika sonra tekrar deneyin.')
    }

    const admin = createAdminClient()
    const { rows: tsRows } = await queryTimesheet(admin, storeId, month, { includeHireDate: true })
    const rows = toPayrollRows(month, tsRows)

    if (!format) return NextResponse.json({ month, rows })

    const { data: store, error: storeErr } = await admin.from('stores').select('name').eq('id', storeId).maybeSingle()
    if (storeErr) throw storeErr
    const storeName = (store as { name: string } | null)?.name ?? ''
    const slug = storeFileSlug(storeName)
    const filename = `bordro-puantaj-${month}-${slug}.${format}`
    const headers = { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${filename}"` }

    let body: BodyInit
    let contentType: string
    if (format === 'csv') {
      body = payrollToCsv(rows)
      contentType = 'text/csv; charset=utf-8'
    } else {
      const generatedAt = new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short',
      }).format(new Date())
      body = new Uint8Array(await buildPayrollWorkbook(month, rows, storeName || 'Mağaza', `${turkeyToday()} (${generatedAt})`))
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }

    // Denetim kaydı dosya başarıyla üretildikten sonra yazılır (timesheet ile aynı)
    await logAudit({
      actorId: auth.employee.id, storeId, action: 'report.payroll.export', entityType: 'report', entityId: month,
      note: `${format} · ${rows.length} çalışan`,
    })
    return new NextResponse(body, { headers: { ...headers, 'Content-Type': contentType } })
  } catch (err) {
    return serverError('GET /api/reports/payroll', err)
  }
}
