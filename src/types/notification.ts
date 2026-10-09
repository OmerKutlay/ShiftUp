/**
 * Notification tipleri ve arayüzleri — FAZ 10
 */

export type NotificationType =
  | 'shift_reminder'
  | 'leave_submitted'
  | 'leave_approved'
  | 'leave_rejected'
  | 'attendance_override'
  | 'open_shift_available'
  | 'time_correction_submitted'
  | 'time_correction_approved'
  | 'time_correction_rejected'

export interface Notification {
  id: string
  employee_id: string
  type: NotificationType
  title: string
  message: string
  is_read: boolean
  related_id: string | null
  created_at: string
}

export interface CreateNotificationPayload {
  employee_id: string
  type: NotificationType
  title: string
  message: string
  related_id?: string | null
}
