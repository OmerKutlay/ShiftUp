/**
 * FAZ 11 — Workforce Planning tipleri
 * Availability, Open Shifts, Shift Swap
 */

// ─── Availability ────────────────────────────────────────────
export type DayOfWeek =
  | 'monday' | 'tuesday' | 'wednesday'
  | 'thursday' | 'friday' | 'saturday' | 'sunday'

export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, string> = {
  monday: 'Pazartesi', tuesday: 'Salı', wednesday: 'Çarşamba',
  thursday: 'Perşembe', friday: 'Cuma', saturday: 'Cumartesi', sunday: 'Pazar',
}

export interface EmployeeAvailability {
  id: string
  employee_id: string
  day_of_week: DayOfWeek
  start_time: string   // 'HH:MM'
  end_time: string     // 'HH:MM'
  is_available: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export interface CreateAvailabilityPayload {
  employee_id: string
  day_of_week: DayOfWeek
  start_time: string
  end_time: string
  is_available?: boolean
  note?: string | null
}

// ─── Open Shifts ─────────────────────────────────────────────
export type OpenShiftStatus = 'open' | 'filled' | 'cancelled'

export interface OpenShift {
  id: string
  work_date: string    // 'YYYY-MM-DD'
  start_time: string   // 'HH:MM'
  end_time: string     // 'HH:MM'
  role_needed: string | null
  description: string | null
  status: OpenShiftStatus
  filled_by: string | null
  created_at: string
  updated_at: string
  // join
  filled_by_employee?: { id: string; full_name: string } | null
}

export interface CreateOpenShiftPayload {
  work_date: string
  start_time: string
  end_time: string
  role_needed?: string | null
  description?: string | null
}

// ─── Shift Swap ───────────────────────────────────────────────
export type SwapStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface ShiftSwapRequest {
  id: string
  requester_id: string
  requester_shift_id: string
  target_id: string | null
  target_shift_id: string | null
  status: SwapStatus
  /** Hedef çalışanın teklifi kabul ettiği an — yönetici onayı ancak bundan sonra verilebilir */
  target_accepted_at: string | null
  reviewed_by?: string | null
  requester_note: string | null
  reviewer_note: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  // joins
  requester?: { id: string; full_name: string }
  target?: { id: string; full_name: string } | null
  requester_shift?: { work_date: string; start_time: string; end_time: string }
  target_shift?: { work_date: string; start_time: string; end_time: string } | null
}

export interface CreateSwapRequestPayload {
  /** Sunucu tarafından yoksayılır — talep eden her zaman oturumdaki çalışandır */
  requester_id?: string
  requester_shift_id: string
  target_id: string
  target_shift_id?: string | null
  requester_note?: string | null
}
