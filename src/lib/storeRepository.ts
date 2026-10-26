/**
 * storeRepository — mağaza (stores) CRUD. Yalnızca server.
 *
 * Mağaza silinmez; pasife alınır (geçmiş vardiya/puantaj kayıtları mağazaya bağlıdır).
 * Aktif çalışanı olan mağaza pasife alınamaz.
 */
import { db } from '@/lib/db'
import type { Store, StoreWithStats } from '@/types/store'

export class StoreValidationError extends Error {
  constructor(message: string, public code = 'VALIDATION_ERROR') {
    super(message)
    this.name = 'StoreValidationError'
  }
}

const STORE_FIELDS = 'id, name, active, created_at, updated_at'

export function normalizeStoreName(value: unknown): string {
  if (typeof value !== 'string') throw new StoreValidationError('Mağaza adı zorunludur.')
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) throw new StoreValidationError('Mağaza adı zorunludur.')
  if (name.length > 120) throw new StoreValidationError('Mağaza adı en fazla 120 karakter olabilir.')
  return name
}

/** 23505: uq_stores_name_lower */
function mapUniqueViolation(error: { code?: string } | null): never | void {
  if (error?.code === '23505') {
    throw new StoreValidationError('Bu adla bir mağaza zaten var.', 'DUPLICATE_STORE_NAME')
  }
}

export async function fetchStore(id: string): Promise<Store | null> {
  const { data, error } = await db.from('stores').select(STORE_FIELDS).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Store | null) ?? null
}

/** Mağazalar + aktif çalışan sayıları (ada göre) */
export async function fetchStores({ ids }: { ids?: string[] } = {}): Promise<StoreWithStats[]> {
  let query = db.from('stores').select(STORE_FIELDS).order('name')
  if (ids) query = query.in('id', ids)
  const { data, error } = await query
  if (error) throw error
  const stores = (data ?? []) as Store[]
  if (stores.length === 0) return []

  const { data: employees, error: empError } = await db
    .from('employees')
    .select('store_id')
    .eq('active', true)
    .in('store_id', stores.map((s) => s.id))
  if (empError) throw empError

  const counts = new Map<string, number>()
  for (const e of (employees ?? []) as { store_id: string }[]) {
    counts.set(e.store_id, (counts.get(e.store_id) ?? 0) + 1)
  }
  return stores.map((s) => ({ ...s, employee_count: counts.get(s.id) ?? 0 }))
}

export async function createStore(input: { name: unknown }): Promise<Store> {
  const name = normalizeStoreName(input.name)
  const { data, error } = await db.from('stores').insert({ name }).select(STORE_FIELDS).single()
  mapUniqueViolation(error)
  if (error) throw error
  return data as Store
}

export async function updateStore(
  id: string,
  input: { name?: unknown; active?: unknown }
): Promise<{ before: Store; after: Store } | null> {
  const before = await fetchStore(id)
  if (!before) return null

  const patch: Partial<Pick<Store, 'name' | 'active'>> = {}
  if (input.name !== undefined) patch.name = normalizeStoreName(input.name)
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') throw new StoreValidationError('active boolean olmalıdır.')
    patch.active = input.active
  }
  if (Object.keys(patch).length === 0) throw new StoreValidationError('Güncellenecek alan yok.')

  if (patch.active === false && before.active) {
    const { count, error } = await db
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', id)
      .eq('active', true)
    if (error) throw error
    if ((count ?? 0) > 0) {
      throw new StoreValidationError(
        `Mağazada ${count} aktif çalışan var. Pasife almadan önce çalışanları başka mağazaya taşıyın veya pasife alın.`,
        'STORE_HAS_EMPLOYEES'
      )
    }
  }

  const { data, error } = await db.from('stores').update(patch).eq('id', id).select(STORE_FIELDS).single()
  mapUniqueViolation(error)
  if (error) throw error
  return { before, after: data as Store }
}
