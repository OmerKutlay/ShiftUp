// Domain types for ShiftUp — strongly typed, matches DB schema

export type AttendanceStatus =
  | 'shift_waiting'
  | 'working'
  | 'on_break'
  | 'working_after_break'
  | 'clocked_out'

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  shift_waiting: 'Vardiya Bekleniyor',
  working: 'Çalışıyor',
  on_break: 'Molada',
  working_after_break: 'Çalışıyor',
  clocked_out: 'Çıkış Yaptı',
}

export interface Employee {
  id: string
  full_name: string
  role: string        // pozisyon/unvan serbest metin (eski vardiya sistemiyle uyumluluk)
  role_id: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface ShiftAssignment {
  id: string
  employee_id: string
  shift_template_id: string | null  // FAZ 4: template referansı (SET NULL on delete)
  work_date: string    // 'YYYY-MM-DD'
  start_time: string   // 'HH:MM' veya 'HH:MM:SS'
  end_time: string     // 'HH:MM' veya 'HH:MM:SS'
  is_on_leave: boolean // FAZ 12: izin onaylanınca true olur, vardiya silinmez
  created_at: string
  updated_at: string
}

export interface AttendanceRecord {
  id: string
  employee_id: string
  shift_assignment_id: string
  status: AttendanceStatus
  clock_in_at: string | null
  break_start_at: string | null
  break_end_at: string | null
  clock_out_at: string | null
  completed_break_minutes: number  // önceki molaların toplamı (son mola hariç)
  verification_method: string | null
  exception_note: string | null
  created_at: string
  updated_at: string
}

// Joined view used by DailyAttendancePage
export interface DailyShiftEntry {
  employee: Employee
  shiftAssignment: ShiftAssignment
  attendanceRecord: AttendanceRecord | null
}
