/**
 * GET    /api/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD — resmi tatiller (oturum gerektirir)
 * POST   /api/holidays  { date, name, half_day } — ekle/güncelle (Mağaza Müdürü+)
 * DELETE /api/holidays?date=YYYY-MM-DD           — sil (Mağaza Müdürü+)
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireMinRole, ROLES } from '@/lib/auth'
import { fetchHolidaysInRange, upsertHoliday, deleteHoliday } from '@/lib/holidayRepository'
import { badRequest, readJson, serverError } from '@/lib/apiErrors'
import { isValidDate } from '@/lib/validation'
import { logAudit } from '@/lib/auditLog'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  if (!isValidDate(from) || !isValidDate(to) || from > to) return badRequest('Geçerli from/to tarihleri gerekli.')
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 800) return badRequest('Aralık en fazla 800 gün olabilir.')

  try {
    return NextResponse.json({ holidays: await fetchHolidaysInRange(from, to) })
  } catch (err) {
    return serverError('GET /api/holidays', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MAGAZA_MUDURU)
  if ('response' in auth) return auth.response

  const body = await readJson<{ date?: string; name?: string; half_day?: boolean }>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')
  if (!isValidDate(body.date)) return badRequest('Geçerli tarih giriniz.')
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) {
    return badRequest('Tatil adı zorunludur (en fazla 120 karakter).')
  }

  try {
    const holiday = await upsertHoliday({ date: body.date, name: body.name.trim(), half_day: body.half_day === true })
    await logAudit({ actorId: auth.employee.id, action: 'holiday.upsert', entityType: 'public_holiday', entityId: body.date, after: holiday })
    return NextResponse.json({ holiday }, { status: 201 })
  } catch (err) {
    return serverError('POST /api/holidays', err)
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireMinRole(req, ROLES.MAGAZA_MUDURU)
  if ('response' in auth) return auth.response

  const date = req.nextUrl.searchParams.get('date')
  if (!isValidDate(date)) return badRequest('Geçerli tarih giriniz.')

  try {
    await deleteHoliday(date)
    await logAudit({ actorId: auth.employee.id, action: 'holiday.delete', entityType: 'public_holiday', entityId: date })
    return NextResponse.json({ success: true })
  } catch (err) {
    return serverError('DELETE /api/holidays', err)
  }
}
