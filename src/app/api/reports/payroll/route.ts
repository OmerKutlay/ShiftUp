/**
 * GET /api/reports/payroll?month=YYYY-MM[&export=xlsx|csv]
 * Bordro puantajı — muhasebeye verilecek aylık çalışan toplamları (çalışılan gün, normal/fazla mesai
 * saati, tatil/izin/rapor günleri, SGK prim günü, eksik gün nedeni kodu). Müdür Yardımcısı+ (timesheet ile aynı).
 * Yalnızca aktif mağazanın vardiyaları. Her zaman JSON döner.
 * export=xlsx|csv → indirme niyeti: dosya TARAYICIDA üretilir (Worker CPU sınırı), sunucu yalnızca
 * mağaza adını ekler, hız sınırını uygular ve denetim kaydını yazar. İndirmeler kişisel veri dışa
 * aktarımıdır: kullanıcı başına hız sınırı + denetim kaydı. Eski `format=` parametresi (dosyayı sunucuda
 * üreten önceki istemci) 409 CLIENT_OUTDATED alır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, clientOutdated, serverError, tooManyRequests } from '@/lib/apiErrors'
import { queryTimesheet } from '@/lib/timesheetQuery'
import { toPayrollRows } from '@/lib/payrollTimesheet'
import { checkRateLimit } from '@/lib/rateLimiter'
import { logAudit } from '@/lib/auditLog'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const EXPORT_LIMIT = 10
const EXPORT_WINDOW_MS = 10 * 60 * 1000

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response
  const storeId = auth.employee.store_id

  const month = req.nextUrl.searchParams.get('month') ?? ''
  if (!MONTH_RE.test(month)) return badRequest('month YYYY-MM formatında olmalıdır.')
  // Eski istemci format= ile dosyanın kendisini bekler; artık JSON döndüğü için bozuk dosya inerdi
  if (req.nextUrl.searchParams.has('format')) return clientOutdated()
  const format = req.nextUrl.searchParams.get('export')
  if (format !== null && format !== 'xlsx' && format !== 'csv') return badRequest('export xlsx veya csv olmalıdır.')

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

    // Veri istemciye verildiği anda denetim kaydı yazılır (dosyayı tarayıcı üretir)
    await logAudit({
      actorId: auth.employee.id, storeId, action: 'report.payroll.export', entityType: 'report', entityId: month,
      note: `${format} · ${rows.length} çalışan`,
    })
    return NextResponse.json({ month, rows, storeName }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return serverError('GET /api/reports/payroll', err)
  }
}
