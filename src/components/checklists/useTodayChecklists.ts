'use client'

/**
 * useTodayChecklists — Bugün görünümü ve Günlük operasyon özet şeridi AYNI SWR anahtarını ve
 * aynı ayarları paylaşır: tek istek, 5 dakikada bir + sekmeye dönüşte tazeleme. Gecikenler için
 * yöneticiye ayrıca pg_cron bildirimi gider; sık yoklama Worker CPU'su harcar (ücretsiz plan, 1102).
 */
import useSWR from 'swr'
import { CHECKLISTS_TODAY_KEY, fetchTodayChecklists } from '@/lib/api/checklists'

export function useTodayChecklists() {
  return useSWR(CHECKLISTS_TODAY_KEY, fetchTodayChecklists, {
    refreshInterval: 300_000,
    revalidateOnFocus: true,
  })
}
