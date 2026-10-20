/**
 * attendanceReportQuery — Devam raporu sorgusu (yalnızca server-side)
 *
 * GET /api/reports/attendance tarafından admin client ile çağrılır.
 * Satır eşleme (mapReportRow) saf fonksiyondur, test edilebilir.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AttendanceReportRow,
  AttendanceReportFilters,
  AttendanceReportStatus,
} from '@/types/report'
import { deductedBreakMinutes, workedMinutes } from '@/lib/attendanceDurations'
import { plannedBreakMins } from '@/lib/workingTimeService'
import { DEFAULT_ATTENDANCE_ALERT_CONFIG } from '@/lib/attendanceAlerts'

const REPORT_PAGE_SIZE = 1000
/** Giriş okutulmamış vardiya, başlangıçtan bu kadar sonra "gelmedi" sayılır (uyarı eşiğiyle aynı) */
const NO_SHOW_GRACE_MS = DEFAULT_ATTENDANCE_ALERT_CONFIG.missedClockInMins * 60 * 1000

/**
 * Vardiya başlangıç anı (epoch ms). Vardiya saatleri Türkiye yerel saatidir;
 * Türkiye 2016'dan beri sabit UTC+3 (bkz. attendanceAlerts.getShiftWindow).
 */
function shiftStartMs(workDate: string, startTime: string): number {
  return new Date(`${workDate}T${startTime.slice(0, 5)}:00+03:00`).getTime()
}

function buildReportQuery(client: SupabaseClient, filters: AttendanceReportFilters) {
  let query = client
    .from('shift_assignments')
    .select(`
      id,
      employee_id,
      work_date,
      start_time,
      end_time,
      is_on_leave,
      shift_templates ( name ),
      employees ( id, full_name ),
      attendance_records (
        id,
        status,
        clock_in_at,
        break_start_at,
        break_end_at,
        clock_out_at,
        completed_break_minutes,
        verification_method,
        exception_note
      )
    `)
    .gte('work_date', filters.date_from)
    .lte('work_date', filters.date_to)
    .order('work_date', { ascending: true })
    .order('start_time', { ascending: true })
    // Sayfalar arası kararlı sıralama için benzersiz anahtar
    .order('id', { ascending: true })

  if (filters.employee_id) {
    query = query.eq('employee_id', filters.employee_id)
  }

  return query
}

/**
 * Tarih aralığındaki tüm vardiyaları attendance kayıtlarıyla çeker.
 * PostgREST max_rows (1000) sınırını aşan aralıklar için sayfalı çekim yapar.
 */
export async function queryAttendanceReport(
  client: SupabaseClient,
  filters: AttendanceReportFilters,
  now: number = Date.now()
): Promise<AttendanceReportRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = []
  for (let from = 0; ; from += REPORT_PAGE_SIZE) {
    const { data: page, error } = await buildReportQuery(client, filters)
      .range(from, from + REPORT_PAGE_SIZE - 1)
    if (error) throw new Error(`Rapor yüklenemedi: ${error.message}`)
    if (!page || page.length === 0) break
    data.push(...page)
    if (page.length < REPORT_PAGE_SIZE) break
  }

  return data.map((row) => mapReportRow(row, now))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapReportRow(row: any, now: number): AttendanceReportRow {
  // attendance_records Supabase'den array olarak gelir (to-many)
  const rec = Array.isArray(row.attendance_records)
    ? (row.attendance_records[0] ?? null)
    : (row.attendance_records ?? null)

  const isOnLeave = (row.is_on_leave ?? false) as boolean
  let status: AttendanceReportStatus = rec?.status ?? 'shift_waiting'
  if (!rec) {
    if (isOnLeave) status = 'on_leave'
    // Vardiya yeni başladıysa (tolerans süresi dolmadan) "gelmedi" sayılmaz
    else if (shiftStartMs(row.work_date, row.start_time) + NO_SHOW_GRACE_MS > now) status = 'upcoming'
  }

  const times = {
    clock_in_at: rec?.clock_in_at ?? null,
    break_start_at: rec?.break_start_at ?? null,
    break_end_at: rec?.break_end_at ?? null,
    clock_out_at: rec?.clock_out_at ?? null,
    completed_break_minutes: rec?.completed_break_minutes ?? 0,
  }
  const hasBreak = !!times.clock_out_at || !!times.break_start_at || times.completed_break_minutes > 0
  // Planlanan mola ile fiili moladan büyüğü düşülür; vardiya bitmeden yalnızca fiili mola gösterilir
  const planned = plannedBreakMins(row.start_time, row.end_time)

  return {
    record_id: rec?.id ?? null,
    employee_id: row.employee_id,
    full_name: row.employees?.full_name ?? '—',
    work_date: row.work_date,
    shift_name: row.shift_templates?.name ?? null,
    start_time: row.start_time,
    end_time: row.end_time,
    status,
    is_on_leave: isOnLeave,
    clock_in_at: times.clock_in_at,
    break_start_at: times.break_start_at,
    break_end_at: times.break_end_at,
    clock_out_at: times.clock_out_at,
    worked_minutes: workedMinutes(times, planned),
    break_minutes: hasBreak ? deductedBreakMinutes(times, times.clock_out_at ? planned : 0) : null,
    verification_method: rec?.verification_method ?? null,
    exception_note: rec?.exception_note ?? null,
  }
}
