// Attendance Report domain types — FAZ 7

export interface AttendanceReportRow {
  employee_id: string
  full_name: string
  work_date: string           // 'YYYY-MM-DD'
  shift_name: string | null   // shift_template name
  start_time: string          // vardiya başlangıç
  end_time: string            // vardiya bitiş
  status: string              // attendance status
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
  attended_shifts: number     // status !== 'shift_waiting'
  total_worked_minutes: number
  total_break_minutes: number
  clocked_out_count: number
  no_show_count: number       // shift_waiting olanlar
}

// Manuel override payload — FAZ 7
export interface ManualAttendanceOverride {
  record_id: string
  status?: string
  clock_in_at?: string | null
  break_start_at?: string | null
  break_end_at?: string | null
  clock_out_at?: string | null
  exception_note: string  // zorunlu — override sebebi
}
