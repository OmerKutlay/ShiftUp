/**
 * notificationLinks — bildirim tipinden uygulama içi hedef sayfaya (deep link) eşleme.
 *
 * Hem bildirim panelinde tıklamada hem de push bildiriminde (service worker → data.url)
 * kullanılır. send-push Edge Function aynı tabloyu supabase/functions/send-push/links.ts
 * içinde tutar (Deno, uygulama koduna import edemez); iki tablonun aynı kalması
 * src/test/notificationLinks.test.ts ile doğrulanır — burada değişiklik yapınca orayı da güncelleyin.
 *
 * Not: Yetkisi olmayan bir sayfaya giden çalışanı middleware kendi ana sayfasına
 * (/my-schedule) yönlendirir; ör. takas teklifi alan çalışan /workforce yerine programını görür.
 */
import type { NotificationType } from '@/types/notification'

export const NOTIFICATION_LINKS: Record<NotificationType, string> = {
  shift_reminder: '/my-schedule',
  leave_submitted: '/leave',
  leave_approved: '/leave',
  leave_rejected: '/leave',
  attendance_override: '/my-schedule',
  open_shift_available: '/open-shifts',
  open_shift_claimed: '/open-shifts',
  time_correction_submitted: '/time-correction',
  time_correction_approved: '/time-correction',
  time_correction_rejected: '/time-correction',
  // Takas onayı yalnızca İş Gücü Planlama > Vardiya Takası sekmesinde (Müdür Yardımcısı+)
  shift_swap_submitted: '/workforce',
  shift_swap_approved: '/my-schedule',
  shift_swap_rejected: '/my-schedule',
  // Geç/eksik okutma uyarıları yöneticilere gider → Günlük Operasyon
  attendance_late_clock_in: '/',
  attendance_late_clock_out: '/',
  attendance_missed_clock_in: '/',
  attendance_missed_clock_out: '/',
  // Test bildirimi → anlık bildirim ayarının bulunduğu Daha fazla sayfası
  push_test: '/more',
}

/** Bilinmeyen tip için varsayılan hedef */
export const DEFAULT_NOTIFICATION_LINK = '/notifications'

/** Bildirim tipinin hedef sayfası (bilinmeyen tip → /notifications) */
export function notificationLink(type: string): string {
  return (NOTIFICATION_LINKS as Record<string, string>)[type] ?? DEFAULT_NOTIFICATION_LINK
}
