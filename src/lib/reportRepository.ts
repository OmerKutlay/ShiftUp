/**
 * Report Repository — FAZ 7
 * Attendance raporları ve özet istatistikler için veri katmanı.
 * Tüm hesaplamalar burada yapılır — UI sadece görüntüler.
 */
import type {
  AttendanceReportRow,
  AttendanceReportFilters,
  AttendanceReportSummary,
} from '@/types/report'

// ============================================================
// Doğrulama
// ============================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Rapor filtrelerini doğrular — client ve API route ortak kullanır.
 * FAZ 8: max 366 günlük aralık guard. Geçerliyse null döner.
 */
export function validateReportFilters(filters: AttendanceReportFilters): string | null {
  if (!DATE_RE.test(filters.date_from) || !DATE_RE.test(filters.date_to)) {
    return 'Geçersiz tarih formatı.'
  }
  const fromMs = new Date(filters.date_from).getTime()
  const toMs = new Date(filters.date_to).getTime()
  if (isNaN(fromMs) || isNaN(toMs)) return 'Geçersiz tarih formatı.'
  if (toMs < fromMs) return 'Bitiş tarihi başlangıç tarihinden önce olamaz.'
  if ((toMs - fromMs) / (1000 * 60 * 60 * 24) > 366) return 'Tarih aralığı en fazla 366 gün olabilir.'
  return null
}

// ============================================================
// Queries
// ============================================================

/**
 * Tarih aralığına göre attendance raporu çeker (GET /api/reports/attendance).
 * Opsiyonel olarak tek çalışan filtrelenebilir.
 */
export async function fetchAttendanceReport(
  filters: AttendanceReportFilters
): Promise<AttendanceReportRow[]> {
  const validationError = validateReportFilters(filters)
  if (validationError) throw new Error(validationError)

  const params = new URLSearchParams({ date_from: filters.date_from, date_to: filters.date_to })
  if (filters.employee_id) params.set('employee_id', filters.employee_id)

  const res = await fetch(`/api/reports/attendance?${params.toString()}`)
  const data = await res.json() as { rows?: AttendanceReportRow[]; error?: string }
  if (!res.ok || !data.rows) {
    throw new Error(data.error ?? 'Rapor yüklenemedi.')
  }
  return data.rows
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
        expected_shifts: 0,
        attended_shifts: 0,
        on_leave_count: 0,
        upcoming_count: 0,
        total_worked_minutes: 0,
        total_break_minutes: 0,
        clocked_out_count: 0,
        no_show_count: 0,
      })
    }
    const summary = byEmployee.get(row.employee_id)!
    summary.total_shifts++
    if (row.status === 'on_leave') summary.on_leave_count++
    else if (row.status === 'upcoming') summary.upcoming_count++
    else {
      summary.expected_shifts++
      if (row.status === 'shift_waiting') summary.no_show_count++
      else summary.attended_shifts++
    }
    if (row.status === 'clocked_out') summary.clocked_out_count++
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
    on_leave: 'İzinli',
    upcoming: 'Başlamadı',
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
