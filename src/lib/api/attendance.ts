/**
 * Client tarafı günlük operasyon API'si — /api/attendance/daily
 * Giriş / mola / çıkış yalnızca QR okutma ile işlenir (/api/qr/process).
 */
import { apiFetch } from './http'
import type { DailyShiftEntry } from '@/types/attendance'

/** Bir günün (varsayılan: bugün, Europe/Istanbul) vardiyaları + devam kayıtları; geçmiş gün yalnızca yöneticiye açık */
export async function fetchDailyShifts(date?: string): Promise<{ date: string; entries: DailyShiftEntry[] }> {
  return apiFetch<{ date: string; entries: DailyShiftEntry[] }>(
    date ? `/api/attendance/daily?date=${encodeURIComponent(date)}` : '/api/attendance/daily'
  )
}
