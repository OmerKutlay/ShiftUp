/**
 * annualLeaveService — çalışanın güncel yıllık izin bakiyesi (server).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAnnualLeaveBalance, countLeaveDays, type AnnualLeaveBalance } from '@/lib/annualLeave'
import { turkeyToday, addDaysToDateString } from '@/lib/dateUtils'

export async function getAnnualLeaveBalance(admin: SupabaseClient, employeeId: string): Promise<AnnualLeaveBalance> {
  const today = turkeyToday()
  const { data: emp, error } = await admin
    .from('employees')
    .select('hire_date, birth_date')
    .eq('id', employeeId)
    .maybeSingle()
  if (error) throw error

  // Dönem en fazla 1 yıl; tatilleri ve talepleri geniş aralıkla çek
  const from = addDaysToDateString(today, -370)
  const to = addDaysToDateString(today, 370)
  const [reqRes, holRes] = await Promise.all([
    admin
      .from('leave_requests')
      .select('start_date, end_date, status')
      .eq('employee_id', employeeId)
      .eq('leave_type', 'annual')
      .lte('start_date', to)
      .gte('end_date', from),
    admin.from('public_holidays').select('date, half_day').gte('date', from).lte('date', to),
  ])
  if (reqRes.error) throw reqRes.error
  if (holRes.error) throw holRes.error

  return computeAnnualLeaveBalance({
    hireDate: (emp?.hire_date as string | null) ?? null,
    birthDate: (emp?.birth_date as string | null) ?? null,
    today,
    requests: (reqRes.data ?? []) as Array<{ start_date: string; end_date: string; status: 'pending' | 'approved' | 'rejected' }>,
    fullDayHolidays: new Set((holRes.data ?? []).filter((h) => !h.half_day).map((h) => h.date as string)),
  })
}

/** Talep edilen aralığın izinden sayılan gün sayısı */
export async function requestedLeaveDays(admin: SupabaseClient, start: string, end: string): Promise<number> {
  const { data, error } = await admin.from('public_holidays').select('date, half_day').gte('date', start).lte('date', end)
  if (error) throw error
  return countLeaveDays(start, end, new Set((data ?? []).filter((h) => !h.half_day).map((h) => h.date as string)))
}
