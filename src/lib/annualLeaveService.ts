/**
 * annualLeaveService — çalışanın güncel yıllık izin bakiyesi (server).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAnnualLeaveBalance, countLeaveDays, type AnnualLeaveBalance } from '@/lib/annualLeave'
import { turkeyToday, addDaysToDateString } from '@/lib/dateUtils'
import { fetchHolidaysInRange } from '@/lib/holidayRepository'

export async function getAnnualLeaveBalance(admin: SupabaseClient, employeeId: string): Promise<AnnualLeaveBalance> {
  const today = turkeyToday()
  const { data: emp, error } = await admin
    .from('employees')
    .select('hire_date, birth_date, store_id')
    .eq('id', employeeId)
    .maybeSingle()
  if (error) throw error

  // Dönem en fazla 1 yıl; tatilleri ve talepleri geniş aralıkla çek
  const from = addDaysToDateString(today, -370)
  const to = addDaysToDateString(today, 370)
  // Resmi tatiller çalışanın mağazasına göre (ulusal + mağaza yerel tatilleri)
  const storeId = (emp?.store_id as string | undefined) ?? null
  const [reqRes, holidays] = await Promise.all([
    admin
      .from('leave_requests')
      .select('start_date, end_date, status')
      .eq('employee_id', employeeId)
      .eq('leave_type', 'annual')
      .lte('start_date', to)
      .gte('end_date', from),
    storeId ? fetchHolidaysInRange(storeId, from, to) : Promise.resolve([]),
  ])
  if (reqRes.error) throw reqRes.error

  return computeAnnualLeaveBalance({
    hireDate: (emp?.hire_date as string | null) ?? null,
    birthDate: (emp?.birth_date as string | null) ?? null,
    today,
    requests: (reqRes.data ?? []) as Array<{ start_date: string; end_date: string; status: 'pending' | 'approved' | 'rejected' }>,
    fullDayHolidays: new Set(holidays.filter((h) => !h.half_day).map((h) => h.date)),
  })
}

/** Talep edilen aralığın izinden sayılan gün sayısı (tatiller çalışanın mağazasına göre) */
export async function requestedLeaveDays(storeId: string, start: string, end: string): Promise<number> {
  const holidays = await fetchHolidaysInRange(storeId, start, end)
  return countLeaveDays(start, end, new Set(holidays.filter((h) => !h.half_day).map((h) => h.date)))
}
