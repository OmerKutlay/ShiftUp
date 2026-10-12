/**
 * Client tarafı günlük operasyon API'si — /api/attendance/daily
 * Giriş / mola / çıkış yalnızca QR okutma ile işlenir (/api/qr/process).
 */
import { apiFetch } from './http'
import type { DailyShiftEntry } from '@/types/attendance'

/** Bugünün (Europe/Istanbul) vardiyaları + devam kayıtları */
export async function fetchDailyShifts(): Promise<{ date: string; entries: DailyShiftEntry[] }> {
  return apiFetch<{ date: string; entries: DailyShiftEntry[] }>('/api/attendance/daily')
}
