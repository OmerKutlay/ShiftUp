/**
 * Client tarafı mağaza API'si — /api/stores
 */
import { apiFetch } from './http'
import type { Store, StoreWithStats } from '@/types/store'

/** Mağaza listesinin SWR anahtarı (değiştirici ve yönetim paneli aynı önbelleği paylaşır) */
export const STORES_KEY = '/api/stores'

export interface StoresResponse {
  stores: StoreWithStats[]
  active_store_id: string
}

/** Erişilebilen mağazalar (Admin: hepsi; diğerleri: kendi mağazası) */
export function fetchStores(): Promise<StoresResponse> {
  return apiFetch<StoresResponse>(STORES_KEY)
}

export async function createStore(name: string): Promise<Store> {
  const { store } = await apiFetch<{ store: Store }>(STORES_KEY, { method: 'POST', body: { name } })
  return store
}

export async function updateStore(id: string, patch: { name?: string; active?: boolean }): Promise<Store> {
  const { store } = await apiFetch<{ store: Store }>(`${STORES_KEY}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  })
  return store
}
