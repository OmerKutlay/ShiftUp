/**
 * timesheetQuery — puantaj için veri toplama (yalnızca server).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTimesheet, timesheetDataRange, type TimesheetRow, type TimesheetShift, type TimesheetEmployee } from '@/lib/timesheet'
import { turkeyToday } from '@/lib/dateUtils'
import type { PublicHoliday } from '@/types/holiday'

const PAGE = 1000

/** PostgREST 1000 satır sınırını aşan aralıklar için sayfalı okuma */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

export async function queryTimesheet(admin: SupabaseClient, month: string): Promise<{ rows: TimesheetRow[]; holidays: PublicHoliday[] }> {
  const { from, to } = timesheetDataRange(month)

  const [employeesRes, holidaysRes] = await Promise.all([
    admin.from('employees').select('id, full_name, role, employment_type, overtime_consent_at, active').order('full_name'),
    admin.from('public_holidays').select('date, name, half_day').gte('date', from).lte('date', to),
  ])
  if (employeesRes.error) throw employeesRes.error
  if (holidaysRes.error) throw holidaysRes.error

  const shiftsRaw = await fetchAll<Record<string, unknown>>((a, b) =>
    admin
      .from('shift_assignments')
      .select(`
        id, employee_id, work_date, start_time, end_time, is_on_leave,
        attendance_records ( clock_in_at, clock_out_at, break_start_at, break_end_at, completed_break_minutes, status )
      `)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('id')
      .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>
  )

  const { data: leaves, error: leaveErr } = await admin
    .from('leave_requests')
    .select('employee_id, leave_type, start_date, end_date')
    .eq('status', 'approved')
    .lte('start_date', to)
    .gte('end_date', from)
  if (leaveErr) throw leaveErr

  const shifts: TimesheetShift[] = shiftsRaw.map((s) => {
    const recs = s.attendance_records as TimesheetShift['attendance'][] | TimesheetShift['attendance'] | null
    const rec = Array.isArray(recs) ? recs[0] ?? null : recs
    return {
      id: s.id as string,
      employee_id: s.employee_id as string,
      work_date: s.work_date as string,
      start_time: s.start_time as string,
      end_time: s.end_time as string,
      is_on_leave: s.is_on_leave as boolean | null,
      attendance: rec,
    }
  })

  // Aktif çalışanlar + ay içinde kaydı olan pasif çalışanlar
  const withData = new Set(shifts.map((s) => s.employee_id))
  const employees = ((employeesRes.data ?? []) as Array<TimesheetEmployee & { active: boolean }>)
    .filter((e) => e.active || withData.has(e.id))

  const rows = buildTimesheet({
    month,
    employees,
    shifts,
    leaves: leaves ?? [],
    holidays: (holidaysRes.data ?? []) as PublicHoliday[],
    today: turkeyToday(),
  })
  return { rows, holidays: (holidaysRes.data ?? []) as PublicHoliday[] }
}
