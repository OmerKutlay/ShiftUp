/**
 * holidayRepository — resmi tatiller (yalnızca server).
 */
import { db } from '@/lib/db'
import type { PublicHoliday } from '@/types/holiday'

export async function fetchHolidaysInRange(from: string, to: string): Promise<PublicHoliday[]> {
  const { data, error } = await db
    .from('public_holidays')
    .select('date, name, half_day')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
  if (error) throw new Error(`Resmi tatiller yüklenemedi: ${error.message}`)
  return (data ?? []) as PublicHoliday[]
}

export async function upsertHoliday(h: PublicHoliday): Promise<PublicHoliday> {
  const { data, error } = await db
    .from('public_holidays')
    .upsert({ date: h.date, name: h.name, half_day: h.half_day }, { onConflict: 'date' })
    .select('date, name, half_day')
    .single()
  if (error) throw new Error(`Resmi tatil kaydedilemedi: ${error.message}`)
  return data as PublicHoliday
}

export async function deleteHoliday(date: string): Promise<void> {
  const { error } = await db.from('public_holidays').delete().eq('date', date)
  if (error) throw new Error(`Resmi tatil silinemedi: ${error.message}`)
}

/** Tarih → tatil haritası (hızlı arama için) */
export function holidayMap(list: PublicHoliday[]): Map<string, PublicHoliday> {
  return new Map(list.map((h) => [h.date, h]))
}
