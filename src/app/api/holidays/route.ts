/**
 * GET    /api/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD
 *        → { holidays: [{ id, date, name, half_day, store_id }] }
 *        Aktif mağazada geçerli tatiller: ulusal (store_id null) + mağazanın yerel tatilleri;
 *        aynı günde yerel olan öncelikli. Oturum gerektirir.
 * POST   /api/holidays  { date, name, half_day, scope?: 'national' | 'store' }
 *        Ekle/güncelle. scope 'store' (varsayılan): aktif mağazanın yerel tatili (Mağaza Müdürü+);
 *        scope 'national': tüm mağazalar için ulusal tatil (yalnızca Admin).
 * DELETE /api/holidays?date=YYYY-MM-DD[&scope=national|store]
 *        Aynı yetki kuralı; silinecek kayıt yoksa 404.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireMinRole, ACCESS, forbidden } from '@/lib/auth'
import { fetchHolidaysInRange, upsertHoliday, deleteHoliday } from '@/lib/holidayRepository'
import { badRequest, notFound, readJson, serverError } from '@/lib/apiErrors'
import { isValidDate } from '@/lib/validation'
import { logAudit } from '@/lib/auditLog'
import { canSwitchStore } from '@/lib/storeScope'

type Scope = 'national' | 'store'

/** scope değeri: yok → 'store'; geçersiz → null */
function parseScope(v: unknown): Scope | null {
  if (v === undefined || v === null || v === '') return 'store'
  return v === 'national' || v === 'store' ? v : null
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if ('response' in auth) return auth.response

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  if (!isValidDate(from) || !isValidDate(to) || from > to) return badRequest('Geçerli from/to tarihleri gerekli.')
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 1100) return badRequest('Aralık en fazla 1100 gün olabilir.')

  try {
    return NextResponse.json({ holidays: await fetchHolidaysInRange(auth.employee.store_id, from, to) })
  } catch (err) {
    return serverError('GET /api/holidays', err)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const body = await readJson<{ date?: string; name?: string; half_day?: boolean; scope?: string }>(req)
  if (!body) return badRequest('Geçersiz istek gövdesi.')
  if (!isValidDate(body.date)) return badRequest('Geçerli tarih giriniz.')
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) {
    return badRequest('Tatil adı zorunludur (en fazla 120 karakter).')
  }
  const scope = parseScope(body.scope)
  if (!scope) return badRequest('scope national veya store olmalıdır.')
  // Ulusal tatil tüm mağazaları etkiler — yalnızca şirket geneli yetki (Admin)
  if (scope === 'national' && !canSwitchStore(employee.access_level)) {
    return forbidden('Ulusal tatili yalnızca Admin yönetebilir.')
  }

  try {
    const holiday = await upsertHoliday(scope === 'national' ? null : employee.store_id, {
      date: body.date, name: body.name.trim(), half_day: body.half_day === true,
    })
    await logAudit({
      actorId: employee.id,
      // Ulusal tatil de işlemin yapıldığı (adminin aktif) mağazanın denetim kaydında görünür
      storeId: employee.store_id,
      action: 'holiday.upsert',
      entityType: 'public_holiday',
      entityId: body.date,
      after: holiday,
    })
    return NextResponse.json({ holiday }, { status: 201 })
  } catch (err) {
    return serverError('POST /api/holidays', err)
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireMinRole(req, ACCESS.STORE_MANAGER)
  if ('response' in auth) return auth.response
  const { employee } = auth

  const date = req.nextUrl.searchParams.get('date')
  if (!isValidDate(date)) return badRequest('Geçerli tarih giriniz.')
  const scope = parseScope(req.nextUrl.searchParams.get('scope'))
  if (!scope) return badRequest('scope national veya store olmalıdır.')
  if (scope === 'national' && !canSwitchStore(employee.access_level)) {
    return forbidden('Ulusal tatili yalnızca Admin yönetebilir.')
  }

  try {
    const storeId = scope === 'national' ? null : employee.store_id
    const deleted = await deleteHoliday(storeId, date)
    if (!deleted) return notFound('Tatil bulunamadı.')
    await logAudit({
      actorId: employee.id,
      storeId: employee.store_id,
      action: 'holiday.delete',
      entityType: 'public_holiday',
      entityId: date,
      note: scope === 'national' ? 'Ulusal tatil' : null,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return serverError('DELETE /api/holidays', err)
  }
}
