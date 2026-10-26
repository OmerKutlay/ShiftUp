/**
 * Bildirim tipi → uygulama içi hedef sayfa (push bildirimine tıklanınca açılır).
 *
 * src/lib/notificationLinks.ts'nin KOPYASIDIR (Edge Function uygulama koduna import edemez).
 * İki tablo src/test/notificationLinks.test.ts ile karşılaştırılır; birini değiştirirseniz
 * diğerini de güncelleyin. Bu dosya import içermemeli (hem Deno hem Vitest yükler).
 */
export const NOTIFICATION_LINKS: Record<string, string> = {
  shift_reminder: '/my-schedule',
  shift_changed: '/my-schedule',
  schedule_published: '/my-schedule',
  store_norm_set: '/schedule',
  leave_submitted: '/leave',
  leave_approved: '/leave',
  leave_rejected: '/leave',
  attendance_override: '/my-schedule',
  open_shift_available: '/open-shifts',
  open_shift_claimed: '/open-shifts',
  time_correction_submitted: '/time-correction',
  time_correction_approved: '/time-correction',
  time_correction_rejected: '/time-correction',
  shift_swap_submitted: '/workforce?tab=swap',
  shift_swap_approved: '/my-schedule',
  shift_swap_rejected: '/my-schedule',
  attendance_late_clock_in: '/',
  attendance_late_clock_out: '/',
  attendance_missed_clock_in: '/',
  attendance_missed_clock_out: '/',
  attendance_break_ending: '/my-schedule',
  push_test: '/more',
}

export const DEFAULT_NOTIFICATION_LINK = '/notifications'

export function notificationLink(type: string): string {
  return NOTIFICATION_LINKS[type] ?? DEFAULT_NOTIFICATION_LINK
}

/** Zamana duyarlı tipler — push servisi gecikmeden iletsin (Urgency: high) */
export function isUrgentType(type: string): boolean {
  return type === 'shift_reminder' || type === 'shift_changed' || type.startsWith('attendance_')
}
