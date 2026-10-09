/**
 * Report Repository — FAZ 7
 * Attendance raporları ve özet istatistikler için veri katmanı.
 * Tüm hesaplamalar burada yapılır — UI sadece görüntüler.
 */
import { supabase } from '@/lib/supabase'
import type {
  AttendanceReportRow,
  AttendanceReportFilters,
  AttendanceReportSummary,
} from '@/types/report'

// ============================================================
// Zaman yardımcıları
// ============================================================

/**
 * İki ISO timestamp arasındaki farkı dakika cinsinden hesaplar.
 * null gönderilirse null döner.
 */
function diffMinutes(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const diff = (new Date(to).getTime() - new Date(from).getTime()) / 60000
  return Math.max(0, Math.round(diff))
}

/**
 * Çalışılan net süreyi hesaplar (mola hariç).
 * clock_in → clock_out — break_duration
 */
function calcWorkedMinutes(row: {
  clock_in_at: string | null
  break_start_at: string | null
  break_end_at: string | null
  clock_out_at: string | null
}): number | null {
  if (!row.clock_in_at || !row.clock_out_at) return null
  const total = diffMinutes(row.clock_in_at, row.clock_out_at) ?? 0
  const breakMin = diffMinutes(row.break_start_at, row.break_end_at) ?? 0
  return Math.max(0, total - breakMin)
}

// ============================================================
// Queries
// ============================================================

/**
 * Tarih aralığına göre attendance raporu çeker.
 * Opsiyonel olarak tek çalışan filtrelenebilir.
 * FAZ 8: max 366 günlük aralık guard.
 */
export async function fetchAttendanceReport(
  filters: AttendanceReportFilters
): Promise<AttendanceReportRow[]> {
  // FAZ 8: Tarih aralığı kontrolü — maks 366 gün
  const fromMs = new Date(filters.date_from).getTime()
  const toMs = new Date(filters.date_to).getTime()
  if (isNaN(fromMs) || isNaN(toMs)) {
    throw new Error('Geçersiz tarih formatı.')
  }
  if (toMs < fromMs) {
    throw new Error('Bitiş tarihi başlangıç tarihinden önce olamaz.')
  }
  const daysDiff = (toMs - fromMs) / (1000 * 60 * 60 * 24)
  if (daysDiff > 366) {
    throw new Error('Tarih aralığı en fazla 366 gün olabilir.')
  }
  let query = supabase
    .from('shift_assignments')
    .select(`
      id,
      employee_id,
      work_date,
      start_time,
      end_time,
      shift_templates ( name ),
      employees ( id, full_name ),
      attendance_records (
        id,
        status,
        clock_in_at,
        break_start_at,
        break_end_at,
        clock_out_at,
        verification_method,
        exception_note
      )
    `)
    .gte('work_date', filters.date_from)
    .lte('work_date', filters.date_to)
    .order('work_date', { ascending: true })
    .order('start_time', { ascending: true })

  if (filters.employee_id) {
    query = query.eq('employee_id', filters.employee_id)
  }

  const { data, error } = await query

  if (error) throw new Error(`Rapor yüklenemedi: ${error.message}`)
  if (!data) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => {
    // attendance_records Supabase'den array olarak gelir (to-many)
    const rec = Array.isArray(row.attendance_records)
      ? (row.attendance_records[0] ?? null)
      : (row.attendance_records ?? null)

    const breakMin = diffMinutes(rec?.break_start_at ?? null, rec?.break_end_at ?? null)
    const workedMin = calcWorkedMinutes({
      clock_in_at: rec?.clock_in_at ?? null,
      break_start_at: rec?.break_start_at ?? null,
      break_end_at: rec?.break_end_at ?? null,
      clock_out_at: rec?.clock_out_at ?? null,
    })

    return {
      employee_id: row.employee_id,
      full_name: row.employees?.full_name ?? '—',
      work_date: row.work_date,
      shift_name: row.shift_templates?.name ?? null,
      start_time: row.start_time,
      end_time: row.end_time,
      status: rec?.status ?? 'shift_waiting',
      clock_in_at: rec?.clock_in_at ?? null,
      break_start_at: rec?.break_start_at ?? null,
      break_end_at: rec?.break_end_at ?? null,
      clock_out_at: rec?.clock_out_at ?? null,
      worked_minutes: workedMin,
      break_minutes: breakMin,
      verification_method: rec?.verification_method ?? null,
      exception_note: rec?.exception_note ?? null,
    } satisfies AttendanceReportRow
  })
}

/**
 * Rapor verilerinden çalışan bazında özet istatistikler hesaplar.
 * fetchAttendanceReport çıktısını alır — ikinci DB sorgusu gereksiz.
 */
export function buildReportSummary(rows: AttendanceReportRow[]): AttendanceReportSummary[] {
  const byEmployee = new Map<string, AttendanceReportSummary>()

  for (const row of rows) {
    if (!byEmployee.has(row.employee_id)) {
      byEmployee.set(row.employee_id, {
        employee_id: row.employee_id,
        full_name: row.full_name,
        total_shifts: 0,
        attended_shifts: 0,
        total_worked_minutes: 0,
        total_break_minutes: 0,
        clocked_out_count: 0,
        no_show_count: 0,
      })
    }
    const summary = byEmployee.get(row.employee_id)!
    summary.total_shifts++
    if (row.status !== 'shift_waiting') summary.attended_shifts++
    if (row.status === 'clocked_out') summary.clocked_out_count++
    if (row.status === 'shift_waiting') summary.no_show_count++
    summary.total_worked_minutes += row.worked_minutes ?? 0
    summary.total_break_minutes += row.break_minutes ?? 0
  }

  return Array.from(byEmployee.values()).sort((a, b) =>
    a.full_name.localeCompare(b.full_name, 'tr')
  )
}

// ============================================================
// CSV Export
// ============================================================

/**
 * AttendanceReportRow listesini CSV string'e dönüştürür.
 * Tarayıcıda indirme için kullanılır.
 */
export function exportReportToCsv(rows: AttendanceReportRow[]): string {
  const formatTime = (iso: string | null): string => {
    if (!iso) return ''
    try {
      return new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(iso))
    } catch {
      return ''
    }
  }

  const formatMinutes = (mins: number | null): string => {
    if (mins === null) return ''
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}s ${m}d`
  }

  const STATUS_TR: Record<string, string> = {
    shift_waiting: 'Gelmedi',
    working: 'Çalışıyor',
    on_break: 'Molada',
    working_after_break: 'Çalışıyor',
    clocked_out: 'Çıkış Yaptı',
  }

  const headers = [
    'Çalışan', 'Tarih', 'Vardiya', 'Başlangıç', 'Bitiş',
    'Durum', 'Giriş', 'Mola Başlangıç', 'Mola Bitiş', 'Çıkış',
    'Çalışma Süresi', 'Mola Süresi', 'Doğrulama', 'Not',
  ]

  const escape = (v: string | null | undefined): string => {
    if (!v) return ''
    const s = String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        escape(r.full_name),
        escape(r.work_date),
        escape(r.shift_name),
        escape(r.start_time.slice(0, 5)),
        escape(r.end_time.slice(0, 5)),
        escape(STATUS_TR[r.status] ?? r.status),
        escape(formatTime(r.clock_in_at)),
        escape(formatTime(r.break_start_at)),
        escape(formatTime(r.break_end_at)),
        escape(formatTime(r.clock_out_at)),
        escape(formatMinutes(r.worked_minutes)),
        escape(formatMinutes(r.break_minutes)),
        escape(r.verification_method),
        escape(r.exception_note),
      ].join(',')
    ),
  ]

  // BOM — Excel'in Türkçe karakterleri doğru okuması için
  return '\uFEFF' + lines.join('\n')
}
