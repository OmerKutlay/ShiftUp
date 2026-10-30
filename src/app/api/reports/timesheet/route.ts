/**
 * GET /api/reports/timesheet?month=YYYY-MM[&export=xlsx]
 * Aylık puantaj — çalışan × gün kodları, net saat, fazla çalışma, gece çalışması,
 * resmi tatil çalışması, izinler, SGK prim günü. Müdür Yardımcısı+.
 * Yalnızca aktif mağazada çalışılan vardiyalar sayılır (mağaza değiştiren çalışanın eski
 * ayları eski mağazanın puantajında kalır).
 * Her zaman JSON döner. export=xlsx → indirme niyeti: Excel TARAYICIDA üretilir (Worker CPU sınırı),
 * sunucu yalnızca mağaza adını ekler ve denetim kaydını yazar. Eski `format=` parametresi (dosyayı
 * sunucuda üreten önceki istemci) 409 CLIENT_OUTDATED alır.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { badRequest, clientOutdated, serverError } from '@/lib/apiErrors'
import { queryTimesheet } from '@/lib/timesheetQuery'
import { logAudit } from '@/lib/auditLog'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response
  const storeId = auth.employee.store_id

  const month = req.nextUrl.searchParams.get('month') ?? ''
  if (!MONTH_RE.test(month)) return badRequest('month YYYY-MM formatında olmalıdır.')
  // Eski istemci format=xlsx ile dosyanın kendisini bekler; artık JSON döndüğü için bozuk dosya inerdi
  if (req.nextUrl.searchParams.has('format')) return clientOutdated()
  const exportFormat = req.nextUrl.searchParams.get('export')

  try {
    const admin = createAdminClient()
    const { rows, holidays } = await queryTimesheet(admin, storeId, month)

    if (exportFormat === 'xlsx') {
      const { data: store, error: storeErr } = await admin.from('stores').select('name').eq('id', storeId).maybeSingle()
      if (storeErr) throw storeErr
      const storeName = (store as { name: string } | null)?.name ?? ''

      await logAudit({
        actorId: auth.employee.id, storeId, action: 'report.timesheet.export', entityType: 'report', entityId: month,
      })
      return NextResponse.json({ month, rows, holidays, storeName }, { headers: { 'Cache-Control': 'no-store' } })
    }

    return NextResponse.json({ month, rows, holidays })
  } catch (err) {
    return serverError('GET /api/reports/timesheet', err)
  }
}
