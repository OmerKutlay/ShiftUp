/**
 * notificationMeta — bildirim türü → ikon, rozet tonu ve etiket (panel + sayfa ortak).
 * `short` dar panelde, `label` /notifications sayfasında kullanılır.
 */
import {
  BellRing, CalendarCheck, CalendarPlus, CalendarX, CircleCheck, Clock, TriangleAlert, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BadgeTone } from '@/components/ui/badge'
import type { NotificationType } from '@/types/notification'

export interface NotificationMeta {
  Icon: LucideIcon
  tone: Exclude<BadgeTone, 'outline' | 'solid'>
  label: string
  short: string
}

export const NOTIFICATION_META: Record<NotificationType, NotificationMeta> = {
  shift_reminder:              { Icon: Clock,         tone: 'brand',   label: 'Vardiya hatırlatması', short: 'Vardiya' },
  leave_submitted:             { Icon: CalendarPlus,  tone: 'info',    label: 'İzin talebi',          short: 'İzin talebi' },
  leave_approved:              { Icon: CircleCheck,   tone: 'success', label: 'İzin onaylandı',       short: 'Onaylandı' },
  leave_rejected:              { Icon: CalendarX,     tone: 'danger',  label: 'İzin reddedildi',      short: 'Reddedildi' },
  attendance_override:         { Icon: Wrench,        tone: 'warning', label: 'Devam düzeltmesi',     short: 'Düzeltme' },
  open_shift_available:        { Icon: CalendarCheck, tone: 'plum',    label: 'Açık vardiya',         short: 'Açık vardiya' },
  time_correction_submitted:   { Icon: Clock,         tone: 'info',    label: 'Mesai talebi',         short: 'Mesai talebi' },
  time_correction_approved:    { Icon: CircleCheck,   tone: 'success', label: 'Mesai onaylandı',      short: 'Mesai onaylandı' },
  time_correction_rejected:    { Icon: CalendarX,     tone: 'danger',  label: 'Mesai reddedildi',     short: 'Mesai reddedildi' },
  shift_swap_submitted:        { Icon: Clock,         tone: 'info',    label: 'Takas talebi',         short: 'Takas talebi' },
  shift_swap_approved:         { Icon: CircleCheck,   tone: 'success', label: 'Takas onaylandı',      short: 'Takas onaylandı' },
  shift_swap_rejected:         { Icon: CalendarX,     tone: 'danger',  label: 'Takas reddedildi',     short: 'Takas reddedildi' },
  open_shift_claimed:          { Icon: CalendarCheck, tone: 'plum',    label: 'Açık vardiya alındı',  short: 'Vardiya alındı' },
  attendance_late_clock_in:    { Icon: TriangleAlert, tone: 'warning', label: 'Geç giriş',            short: 'Geç giriş' },
  attendance_late_clock_out:   { Icon: TriangleAlert, tone: 'warning', label: 'Geç çıkış',            short: 'Geç çıkış' },
  attendance_missed_clock_in:  { Icon: TriangleAlert, tone: 'danger',  label: 'Giriş okutulmadı',     short: 'Giriş yok' },
  attendance_missed_clock_out: { Icon: TriangleAlert, tone: 'danger',  label: 'Çıkış okutulmadı',     short: 'Çıkış yok' },
  push_test:                   { Icon: BellRing,      tone: 'neutral', label: 'Test bildirimi',       short: 'Test' },
}

/** Bilinmeyen (yeni eklenmiş) tür gelirse sayfa çökmesin */
const FALLBACK_META: NotificationMeta = { Icon: BellRing, tone: 'neutral', label: 'Bildirim', short: 'Bildirim' }

export function notificationMeta(type: NotificationType): NotificationMeta {
  return NOTIFICATION_META[type] ?? FALLBACK_META
}

/** Tür ikonunun yumuşak zemini (rozet tonuyla aynı) */
export const ICON_TONE_CLASS: Record<NotificationMeta['tone'], string> = {
  neutral: 'bg-surface-muted text-ink-secondary',
  brand: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  plum: 'bg-plum-soft text-plum',
  peach: 'bg-peach-soft text-peach',
}
