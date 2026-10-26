/**
 * timesheetQuery — puantaj için veri toplama (yalnızca server).
 *
 * Çoklu mağaza: yalnızca aktif mağazada çalışılan vardiyalar (shift_assignments.store_id)
 * sayılır — başka mağazaya geçen çalışanın eski mağazadaki geçmişi eski mağazanın puantajında kalır.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTimesheet, timesheetDataRange, type TimesheetRow, type TimesheetShift, type TimesheetEmployee } from '@/lib/timesheet'
import { turkeyToday } from '@/lib/dateUtils'
import type { PublicHoliday } from '@/types/holiday'
import { NOT_KIOSK_FILTER } from '@/lib/auth/roles'
import { unwrapJoin } from '@/lib/roleJoin'
import { fetchHolidaysInRange } from '@/lib/holidayRepository'

const PAGE = 1000

/** PostgREST 1000 satır sınırını aşan aralıklar için sayfalı okuma */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
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

/**
 * Mağaza raporlarının çalışan listesi: mağazanın aktif çalışanları + dönemde bu mağazada
 * vardiyası olanlar (pasif olsalar da, başka mağazaya geçmiş olsalar da — geçmiş kayıt
 * eski mağazada kalır). `select` en az `id, full_name, active` içermelidir.
 */
export async function fetchStoreReportEmployees<T extends { id: string; active: boolean; full_name: string }>(
  admin: SupabaseClient,
  storeId: string,
  select: string,
  shiftEmployeeIds: Set<string>
): Promise<T[]> {
  const { data, error } = await admin
    .from('employees')
    .select(select)
    .eq('store_id', storeId)
    .or(NOT_KIOSK_FILTER)
    .order('full_name')
  if (error) throw error
  const own = (data ?? []) as unknown as T[]
  const ownIds = new Set(own.map((e) => e.id))

  // Bu mağazada vardiyası olup artık başka mağazada kayıtlı olanlar
  const foreignIds = [...shiftEmployeeIds].filter((id) => !ownIds.has(id))
  let foreign: T[] = []
  if (foreignIds.length > 0) {
    const res = await admin.from('employees').select(select).in('id', foreignIds).or(NOT_KIOSK_FILTER)
    if (res.error) throw res.error
    foreign = (res.data ?? []) as unknown as T[]
  }

  return [...own.filter((e) => e.active || shiftEmployeeIds.has(e.id)), ...foreign]
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'tr'))
}

export async function queryTimesheet(
  admin: SupabaseClient,
  storeId: string,
  month: string,
  opts: { includeHireDate?: boolean } = {}
): Promise<{ rows: TimesheetRow[]; holidays: PublicHoliday[] }> {
  const { from, to } = timesheetDataRange(month)

  const holidays = await fetchHolidaysInRange(storeId, from, to)

  const shiftsRaw = await fetchAll<Record<string, unknown>>((a, b) =>
    admin
      .from('shift_assignments')
      .select(`
        id, employee_id, work_date, start_time, end_time, is_on_leave,
        attendance_records ( clock_in_at, clock_out_at, break_start_at, break_end_at, completed_break_minutes, status )
      `)
      .eq('store_id', storeId)
      .gte('work_date', from)
      .lte('work_date', to)
      .order('id')
      .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>
  )

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

  // Aktif çalışanlar + ay içinde bu mağazada kaydı olan pasif / başka mağazaya geçmiş çalışanlar
  const withData = new Set(shifts.map((s) => s.employee_id))
  type EmpRow = Omit<TimesheetEmployee, 'role_name'> & { active: boolean; roles?: { name: string } | { name: string }[] | null }
  const empRows = await fetchStoreReportEmployees<EmpRow>(
    admin, storeId, `id, full_name, employment_type, overtime_consent_at, active${opts.includeHireDate ? ', hire_date, termination_date' : ''}, roles ( name )`, withData
  )
  const employees: TimesheetEmployee[] = empRows
    .map(({ roles, active: _active, ...rest }) => ({ ...rest, role_name: unwrapJoin(roles)?.name ?? '' }))

  // İzinler yalnızca listedeki çalışanlar için okunur
  let leaves: Array<{ employee_id: string; leave_type: string; start_date: string; end_date: string }> = []
  if (employees.length > 0) {
    const { data, error: leaveErr } = await admin
      .from('leave_requests')
      .select('employee_id, leave_type, start_date, end_date')
      .eq('status', 'approved')
      .in('employee_id', employees.map((e) => e.id))
      .lte('start_date', to)
      .gte('end_date', from)
    if (leaveErr) throw leaveErr
    leaves = data ?? []
  }

  const rows = buildTimesheet({ month, employees, shifts, leaves, holidays, today: turkeyToday() })
  return { rows, holidays }
}
