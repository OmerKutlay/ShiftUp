// Leave Request domain types — FAZ 9

export type LeaveType = 'annual' | 'sick' | 'personal' | 'unpaid' | 'other' | 'weekly_rest'
export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: 'Yıllık İzin',
  sick: 'Hastalık İzni',
  personal: 'Kişisel İzin',
  unpaid: 'Ücretsiz İzin',
  other: 'Diğer',
  weekly_rest: 'Haftalık Tatil',
}

/** weekly_rest tipi manager tarafından doğrudan atanır, onay akışına girmez */
export const WEEKLY_REST_TYPE: LeaveType = 'weekly_rest'

/**
 * Otomatik plan aktarımında (/api/workforce/apply) atanan haftalık tatillerin reason değeri.
 * Elle atanan tatillerden ayırt etmek için kullanılır: plan yeniden oluşturulurken
 * yok sayılır, yeniden aktarılırken yenileriyle değiştirilir.
 */
export const AUTO_WEEKLY_REST_REASON = 'Haftalık tatil (otomatik plan)'

export function isAutoWeeklyRest(l: { leave_type: string; reason: string | null }): boolean {
  return l.leave_type === 'weekly_rest' && l.reason === AUTO_WEEKLY_REST_REASON
}

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Onay Bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
}

export interface LeaveRequest {
  id: string
  employee_id: string
  leave_type: LeaveType
  start_date: string     // 'YYYY-MM-DD'
  end_date: string       // 'YYYY-MM-DD'
  reason: string | null
  status: LeaveStatus
  reviewer_note: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

// Joined: employee bilgisiyle birlikte
export interface LeaveRequestWithEmployee extends LeaveRequest {
  employees: {
    id: string
    full_name: string
    role: string
  } | null
}

// Yeni talep payload — çalışan tarafından
export interface CreateLeaveRequestPayload {
  employee_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  reason?: string | null
}

// Manager incelemesi payload
export interface ReviewLeaveRequestPayload {
  status: 'approved' | 'rejected'
  reviewer_note?: string | null
}
