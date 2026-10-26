'use client'

/**
 * useTodayChecklists — Bugün görünümü ve Günlük operasyon özet şeridi AYNI SWR anahtarını ve
 * aynı ayarları paylaşır: tek istek, 2 dakikada bir + sekmeye dönüşte tazeleme.
 */
import useSWR from 'swr'
import { CHECKLISTS_TODAY_KEY, fetchTodayChecklists } from '@/lib/api/checklists'

export function useTodayChecklists() {
  return useSWR(CHECKLISTS_TODAY_KEY, fetchTodayChecklists, {
    refreshInterval: 120_000,
    revalidateOnFocus: true,
  })
}
