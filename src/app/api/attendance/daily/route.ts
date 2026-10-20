/**
 * GET /api/attendance/daily?date=YYYY-MM-DD
 * Günlük operasyon ekranı: o günün (varsayılan: bugün, Türkiye saati) vardiyaları
 * + devam kayıtları. Müdür Yardımcısı+.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireMinRole, ACCESS } from '@/lib/auth'
import { fetchDailyShifts } from '@/lib/attendanceRepository'
import { badRequest, serverError } from '@/lib/apiErrors'
import { isValidDate } from '@/lib/validation'
import { turkeyToday } from '@/lib/dateUtils'

export async function GET(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.MANAGER)
  if ('response' in auth) return auth.response

  const dateParam = req.nextUrl.searchParams.get('date')
  if (dateParam && !isValidDate(dateParam)) return badRequest('Geçersiz tarih.')
  const date = dateParam ?? turkeyToday()

  try {
    const entries = await fetchDailyShifts(date)
    return NextResponse.json({ date, entries })
  } catch (err) {
    return serverError('GET /api/attendance/daily', err)
  }
}
