// Schedule (Haftalık Vardiya Planı) domain types — FAZ 4
import type { ShiftAssignment } from '@/types/attendance'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'

// Bir shift_assignment kaydı join edilmiş haliyle
export interface ShiftAssignmentWithDetails extends ShiftAssignment {
  shift_templates: ShiftTemplate | null  // Supabase join
  employees: EmployeeWithRole | null     // Supabase join
}

// Haftalık grid hücresi
export interface WeeklyScheduleEntry {
  employee: EmployeeWithRole
  // work_date string → ShiftAssignmentWithDetails | null
  dayAssignments: Record<string, ShiftAssignmentWithDetails | null>
}

// Vardiya atama payload
export interface CreateShiftAssignmentPayload {
  employee_id: string
  shift_template_id: string | null  // null → özel saat (template'siz)
  work_date: string    // 'YYYY-MM-DD'
  start_time: string   // 'HH:MM'
  end_time: string     // 'HH:MM'
}

export interface UpdateShiftAssignmentPayload {
  shift_template_id?: string | null
  start_time?: string
  end_time?: string
}

// Çakışma hatası
export class ShiftConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShiftConflictError'
  }
}
