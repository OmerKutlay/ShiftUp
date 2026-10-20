// Attendance Report domain types — FAZ 7
import type { AttendanceStatus } from '@/types/attendance'

/**
 * Rapor satır durumu: attendance status'larına ek olarak, kaydı olmayan
 * vardiyalar için türetilmiş durumlar:
 *   on_leave → izinli (is_on_leave), upcoming → vardiya henüz başlamadı
 */
export type AttendanceReportStatus = AttendanceStatus | 'on_leave' | 'upcoming'

export interface AttendanceReportRow {
  record_id: string | null    // attendance_records.id — kayıt yoksa null
  employee_id: string
  full_name: string
  work_date: string           // 'YYYY-MM-DD'
  shift_name: string | null   // shift_template name
  start_time: string          // vardiya başlangıç
  end_time: string            // vardiya bitiş
  status: AttendanceReportStatus
  is_on_leave: boolean
  clock_in_at: string | null
  break_start_at: string | null
  break_end_at: string | null
  clock_out_at: string | null
  worked_minutes: number | null  // hesaplanmış çalışma süresi (mola hariç)
  break_minutes: number | null   // mola süresi
  verification_method: string | null
  exception_note: string | null
}

export interface AttendanceReportFilters {
  employee_id?: string        // null = tüm çalışanlar
  date_from: string           // 'YYYY-MM-DD'
  date_to: string             // 'YYYY-MM-DD'
}

export interface AttendanceReportSummary {
  employee_id: string
  full_name: string
  total_shifts: number
  expected_shifts: number     // izinli ve henüz başlamamış vardiyalar hariç
  attended_shifts: number     // giriş yapılmış vardiyalar
  on_leave_count: number
  upcoming_count: number
  total_worked_minutes: number
  total_break_minutes: number
  clocked_out_count: number
  no_show_count: number       // başlamış, izinli olmayan ve giriş yapılmamış vardiyalar
}

// Manuel override payload — FAZ 7
export interface ManualAttendanceOverride {
  record_id: string
  status?: string
  clock_in_at?: string | null
  clock_out_at?: string | null
  // Mola alanları yok: mola elle girilmez, otomatik hesaplanır
  exception_note: string  // zorunlu — override sebebi
}
