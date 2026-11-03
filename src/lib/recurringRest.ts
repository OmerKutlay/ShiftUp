/**
 * recurringRest — tekrarlayan haftalık tatil (server).
 *
 * Kural `recurring_weekly_rests` tablosunda durur; günleri sonraki 26 hafta için gerçek weekly_rest
 * izin kayıtları olarak yazılır (leave_requests.recurrence_id). Üretim, "bu ve sonrakiler" silme ve
 * geri yazma SQL fonksiyonlarındadır (migration 20261103100000_recurring_weekly_rest); gece cron'u ufku taşır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/** EXTRACT(DOW) / Date.getUTCDay sırası: 0 = pazar (belirli tarih bildirmeyen gün adı küçük harfle) */
export const WEEKDAY_NAMES_TR = ['pazar', 'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi'] as const

export const weekdayOf = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay()

/** "Her pazar" */
export const everyWeekdayLabel = (date: string): string => `Her ${WEEKDAY_NAMES_TR[weekdayOf(date)]}`

export interface MaterializeResult {
  created: number
  skipped: number
}

/** Kuralın günlerini ufka kadar yazar. Hata fırlatmaz (gece cron'u eksikleri tamamlar). */
export async function materializeRecurringRest(admin: SupabaseClient, ruleId: string): Promise<MaterializeResult> {
  const { data, error } = await admin.rpc('materialize_recurring_weekly_rests', { p_rule_id: ruleId })
  if (error) {
    console.error('[recurringRest] materialize başarısız:', error)
    return { created: 0, skipped: 0 }
  }
  const r = (data ?? {}) as Partial<MaterializeResult>
  return { created: r.created ?? 0, skipped: r.skipped ?? 0 }
}

/** "Bu ve sonraki haftalar": fromDate dahil sonraki tekrarları siler, kuralı bitirir. Silinen gün sayısı. */
export async function endRecurringRest(admin: SupabaseClient, ruleId: string, fromDate: string): Promise<number> {
  const { data, error } = await admin.rpc('end_recurring_weekly_rest', { p_rule_id: ruleId, p_from: fromDate })
  if (error) throw error
  return typeof data === 'number' ? data : 0
}

/**
 * İzin talebiyle çakışan tekrarlayan tatiller talebe yer açmak için kaldırılır; talep reddedilir ya da
 * silinirse aralıktaki tekrarlar (bugün ve sonrası) geri yazılır. Hata fırlatmaz.
 */
export async function restoreRecurringRests(
  admin: SupabaseClient,
  employeeId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const { data, error } = await admin.rpc('restore_recurring_weekly_rests', {
    p_employee_id: employeeId, p_from: startDate, p_to: endDate,
  })
  if (error) {
    console.error('[recurringRest] restore başarısız:', error)
    return 0
  }
  return typeof data === 'number' ? data : 0
}
