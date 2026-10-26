/**
 * GET /api/attendance/daily?date=YYYY-MM-DD
 * Günlük operasyon ekranı: aktif mağazanın o günkü (varsayılan: bugün, Türkiye saati) vardiyaları
 * + devam kayıtları. Tüm çalışanlara açık (salt okunur); yönetici olmayanlar yalnızca bugünü görür.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, forbidden, hasRole, MANAGER_ROLES } from '@/lib/auth'
import { fetchDailyShifts } from '@/lib/attendanceRepository'
import { badRequest, serverError } from '@/lib/apiErrors'
import { isValidDate } from '@/lib/validation'
import { turkeyToday } from '@/lib/dateUtils'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  const dateParam = req.nextUrl.searchParams.get('date')
  if (dateParam && !isValidDate(dateParam)) return badRequest('Geçersiz tarih.')
  const date = dateParam ?? turkeyToday()
  if (date !== turkeyToday() && !hasRole(auth.employee.access_level, MANAGER_ROLES)) {
    return forbidden('Yalnızca bugünün operasyonunu görüntüleyebilirsiniz.')
  }

  try {
    const entries = await fetchDailyShifts(date, auth.employee.store_id)
    return NextResponse.json({ date, entries })
  } catch (err) {
    return serverError('GET /api/attendance/daily', err)
  }
}
