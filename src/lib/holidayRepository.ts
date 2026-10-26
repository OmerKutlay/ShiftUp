/**
 * holidayRepository — resmi tatiller (yalnızca server).
 *
 * İki kapsam vardır:
 *   store_id NULL  → ulusal tatil, tüm mağazalarda geçerli (yalnızca Admin yönetir)
 *   store_id dolu  → o mağazanın yerel tatili (Mağaza Müdürü+ yönetir)
 * Bir mağaza için tatil listesi = ulusal + o mağazanın yerel tatilleri. Ulusal tatil gününe yerel
 * tatil eklenemez (NationalHolidayConflictError); sonradan aynı güne ulusal tatil eklenirse yine
 * ulusal kayıt geçerlidir — tatil ücretini etkileyen ulusal gün mağaza tarafından değiştirilemez.
 * Tatil hesabı yapan her yer (planlayıcı, puantaj, yıllık izin) fetchHolidaysInRange(storeId, …) kullanmalıdır — public_holidays doğrudan okunmaz.
 */
import { db } from '@/lib/db'
import type { PublicHoliday } from '@/types/holiday'

const FIELDS = 'id, date, name, half_day, store_id'

export class NationalHolidayConflictError extends Error {
  readonly code = 'NATIONAL_HOLIDAY'
  constructor(name: string) {
    super(`Bu tarih ulusal tatil (${name}); mağazaya özel tatil olarak değiştirilemez.`)
    this.name = 'NationalHolidayConflictError'
  }
}

/** Mağazada geçerli tatiller (ulusal + yerel; aynı günde ulusal olan geçerli), tarihe göre */
export async function fetchHolidaysInRange(storeId: string, from: string, to: string): Promise<PublicHoliday[]> {
  const [national, local] = await Promise.all([
    db.from('public_holidays').select(FIELDS).is('store_id', null).gte('date', from).lte('date', to),
    db.from('public_holidays').select(FIELDS).eq('store_id', storeId).gte('date', from).lte('date', to),
  ])
  const error = national.error ?? local.error
  if (error) throw new Error(`Resmi tatiller yüklenemedi: ${error.message}`)

  const byDate = new Map<string, PublicHoliday>()
  for (const h of (local.data ?? []) as PublicHoliday[]) byDate.set(h.date, h)
  for (const h of (national.data ?? []) as PublicHoliday[]) byDate.set(h.date, h)
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Tatili kaydeder; kapsam + tarih aynıysa günceller.
 * storeId null → ulusal tatil. Ulusal tatil gününe yerel kayıt → NationalHolidayConflictError.
 */
export async function upsertHoliday(
  storeId: string | null,
  h: Pick<PublicHoliday, 'date' | 'name' | 'half_day'>
): Promise<PublicHoliday> {
  if (storeId !== null) {
    const { data: national, error: natError } = await db
      .from('public_holidays').select('name').eq('date', h.date).is('store_id', null).maybeSingle()
    if (natError) throw new Error(`Resmi tatil kaydedilemedi: ${natError.message}`)
    if (national) throw new NationalHolidayConflictError((national as { name: string }).name)
  }

  let find = db.from('public_holidays').select('id').eq('date', h.date)
  find = storeId === null ? find.is('store_id', null) : find.eq('store_id', storeId)
  const { data: existing, error: findError } = await find.maybeSingle()
  if (findError) throw new Error(`Resmi tatil kaydedilemedi: ${findError.message}`)

  const row = { date: h.date, name: h.name, half_day: h.half_day, store_id: storeId }
  const { data, error } = existing
    ? await db.from('public_holidays').update(row).eq('id', (existing as { id: string }).id).select(FIELDS).single()
    : await db.from('public_holidays').insert(row).select(FIELDS).single()
  if (error) throw new Error(`Resmi tatil kaydedilemedi: ${error.message}`)
  return data as PublicHoliday
}

/** Kapsamdaki (ulusal: storeId null) tatili siler; silinen kayıt yoksa false */
export async function deleteHoliday(storeId: string | null, date: string): Promise<boolean> {
  let query = db.from('public_holidays').delete().eq('date', date)
  query = storeId === null ? query.is('store_id', null) : query.eq('store_id', storeId)
  const { data, error } = await query.select('id')
  if (error) throw new Error(`Resmi tatil silinemedi: ${error.message}`)
  return (data ?? []).length > 0
}

/** Tarih → tatil haritası (hızlı arama için) */
export function holidayMap(list: PublicHoliday[]): Map<string, PublicHoliday> {
  return new Map(list.map((h) => [h.date, h]))
}
