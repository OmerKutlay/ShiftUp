/**
 * Notification tipleri ve arayüzleri — FAZ 10
 */

export type NotificationType =
  /** Vardiya başlamadan ~1 saat önce çalışana (pg_cron → scan_shift_reminders) */
  | 'shift_reminder'
  /** Yönetici çalışanın vardiyasını ekledi / saatini değiştirdi / kaldırdı (src/lib/shiftNotifications.ts) */
  | 'shift_changed'
  /** Haftalık plan aktarıldı ve çalışanın vardiyaları değişti (POST /api/workforce/apply) */
  | 'schedule_published'
  /** Admin mağazanın aylık norm saatini belirledi (PUT /api/stores/norm) */
  | 'store_norm_set'
  | 'leave_submitted'
  | 'leave_approved'
  | 'leave_rejected'
  | 'attendance_override'
  | 'open_shift_available'
  | 'time_correction_submitted'
  | 'time_correction_approved'
  | 'time_correction_rejected'
  | 'shift_swap_submitted'
  | 'shift_swap_approved'
  | 'shift_swap_rejected'
  | 'open_shift_claimed'
  | 'attendance_late_clock_in'
  | 'attendance_late_clock_out'
  | 'attendance_missed_clock_in'
  | 'attendance_missed_clock_out'
  /** Molada olan çalışana: toplam mola 1 saate yaklaştı (pg_cron → scan_break_ending) */
  | 'attendance_break_ending'
  /** Kontrol listesi son saatini 15 dk geçti, tamamlanmadı (yöneticilere; pg_cron → scan_checklist_overdue) */
  | 'checklist_overdue'
  /** Eski kurulum testi bildirimleri (endpoint kaldırıldı; mevcut kayıtlar için) */
  | 'push_test'

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
