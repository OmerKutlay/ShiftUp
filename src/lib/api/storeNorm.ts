/**
 * Client tarafı mağaza norm saati API'si — /api/stores/norm
 */
import { apiFetch } from './http'
import type { NormLevel, NormSource } from '@/lib/storeNorm'

export interface StoreNormDto {
  /** YYYY-MM-01 */
  month: string
  normHours: number
  source: NormSource
  /** Admin girmediyse kullanılan hesaplanmış tahmin */
  defaultHours: number
  employeeCount: number
  note: string | null
  plannedHours: number
  remainingHours: number
  percent: number
  level: NormLevel
  /** Çıkışı yapılmış vardiyalardaki fiili net saat */
  workedHours: number
}

export interface StoreNormListItem extends StoreNormDto {
  storeId: string
  storeName: string
  updatedAt: string | null
}

const BASE = '/api/stores/norm'

/** 'YYYY-MM-DD' veya 'YYYY-MM' → 'YYYY-MM' */
export const normMonthParam = (month: string) => month.slice(0, 7)

export const storeNormKey = (month: string) => `${BASE}?month=${normMonthParam(month)}`
export const allStoreNormsKey = (month: string) => `${BASE}?month=${normMonthParam(month)}&scope=all`

export async function fetchStoreNorm(month: string): Promise<StoreNormDto> {
  const { norm } = await apiFetch<{ norm: StoreNormDto }>(storeNormKey(month))
  return norm
}

export function setStoreNorm(input: { month: string; normHours: number; note?: string; storeId?: string }) {
  return apiFetch<{ norm: StoreNormDto }>(BASE, {
    method: 'PUT',
    body: { ...input, month: normMonthParam(input.month) },
  })
}

export function clearStoreNorm(month: string, storeId?: string) {
  const q = `month=${normMonthParam(month)}${storeId ? `&storeId=${encodeURIComponent(storeId)}` : ''}`
  return apiFetch<{ norm: StoreNormDto }>(`${BASE}?${q}`, { method: 'DELETE' })
}
