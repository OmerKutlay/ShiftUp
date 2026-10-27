/**
 * notificationLinks — bildirim tipinden uygulama içi hedef sayfaya (deep link) eşleme.
 *
 * Hem bildirim panelinde tıklamada hem de push bildiriminde (service worker → data.url)
 * kullanılır. send-push Edge Function aynı tabloyu supabase/functions/send-push/links.ts
 * içinde tutar (Deno, uygulama koduna import edemez); iki tablonun aynı kalması
 * src/test/notificationLinks.test.ts ile doğrulanır — burada değişiklik yapınca orayı da güncelleyin.
 *
 * Not: Yetkisi olmayan bir sayfaya giden çalışanı middleware kendi ana sayfasına
 * (/my-schedule) yönlendirir. /workforce herkese açıktır; ?tab=swap doğrudan takas sekmesini açar.
 */
import type { NotificationType } from '@/types/notification'

export const NOTIFICATION_LINKS: Record<NotificationType, string> = {
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
  // Takas teklifi (karşı taraf kabul eder) ve yönetici onayı İş Gücü > Vardiya takası sekmesinde
  shift_swap_submitted: '/workforce?tab=swap',
  shift_swap_approved: '/my-schedule',
  shift_swap_rejected: '/my-schedule',
  // Geç/eksik okutma uyarıları yöneticilere gider → Günlük Operasyon
  attendance_late_clock_in: '/',
  attendance_late_clock_out: '/',
  attendance_missed_clock_in: '/',
  attendance_missed_clock_out: '/',
  // Mola bitiş hatırlatması çalışana gider → moladan dönüş okutulan sayfa
  attendance_break_ending: '/my-schedule',
  // Geciken kontrol listesi yöneticilere gider
  checklist_overdue: '/checklists',
  // Duyuru → Duyurular sayfası
  announcement: '/announcements',
  // Veri kaybı uyarısı adminlere gider → Ayarlar (uygulama hata günlüğü)
  data_integrity_alert: '/settings',
  // Test bildirimi → anlık bildirim ayarının bulunduğu Daha fazla sayfası
  push_test: '/more',
}

/** Bilinmeyen tip için varsayılan hedef */
export const DEFAULT_NOTIFICATION_LINK = '/notifications'

/** Bildirim tipinin hedef sayfası (bilinmeyen tip → /notifications) */
export function notificationLink(type: string, relatedId?: string | null): string {
  // Duyuru bildirimi ilgili duyurunun detayını açar (push'ta statik adres: /announcements)
  if (type === 'announcement' && relatedId) return `/announcements?id=${encodeURIComponent(relatedId)}`
  return (NOTIFICATION_LINKS as Record<string, string>)[type] ?? DEFAULT_NOTIFICATION_LINK
}
