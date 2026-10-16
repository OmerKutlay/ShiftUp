/**
 * notificationLinks.test.ts — bildirim tipi → hedef sayfa eşlemesi.
 * Uygulama tablosu (src/lib/notificationLinks.ts) ile send-push Edge Function'ındaki
 * kopyası (supabase/functions/send-push/links.ts) birebir aynı olmalıdır.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NOTIFICATION_LINK,
  NOTIFICATION_LINKS,
  notificationLink,
} from '@/lib/notificationLinks'
import * as edge from '../../supabase/functions/send-push/links'
import type { NotificationType } from '@/types/notification'

// Tüm tipler — yeni tip eklenince TS burada (ve Record<NotificationType, string>'de) hata verir
const ALL_TYPES = {
  shift_reminder: true,
  leave_submitted: true,
  leave_approved: true,
  leave_rejected: true,
  attendance_override: true,
  open_shift_available: true,
  time_correction_submitted: true,
  time_correction_approved: true,
  time_correction_rejected: true,
  shift_swap_submitted: true,
  shift_swap_approved: true,
  shift_swap_rejected: true,
  open_shift_claimed: true,
  attendance_late_clock_in: true,
  attendance_late_clock_out: true,
  attendance_missed_clock_in: true,
  attendance_missed_clock_out: true,
  push_test: true,
} satisfies Record<NotificationType, true>

describe('notificationLinks', () => {
  it('her bildirim tipinin bir hedefi var', () => {
    expect(Object.keys(NOTIFICATION_LINKS).sort()).toEqual(Object.keys(ALL_TYPES).sort())
  })

  it('tüm hedefler aynı origin göreli yol', () => {
    for (const href of Object.values(NOTIFICATION_LINKS)) {
      expect(href.startsWith('/')).toBe(true)
      expect(href.startsWith('//')).toBe(false)
    }
  })

  it('örnek eşlemeler', () => {
    expect(notificationLink('shift_reminder')).toBe('/my-schedule')
    expect(notificationLink('leave_approved')).toBe('/leave')
    expect(notificationLink('time_correction_rejected')).toBe('/time-correction')
    expect(notificationLink('open_shift_available')).toBe('/open-shifts')
    expect(notificationLink('attendance_missed_clock_in')).toBe('/')
  })

  it('bilinmeyen tip varsayılan sayfaya gider', () => {
    expect(notificationLink('nope')).toBe(DEFAULT_NOTIFICATION_LINK)
    expect(edge.notificationLink('nope')).toBe(DEFAULT_NOTIFICATION_LINK)
  })

  it('Edge Function kopyası uygulama tablosuyla birebir aynı', () => {
    expect(edge.NOTIFICATION_LINKS).toEqual(NOTIFICATION_LINKS)
    expect(edge.DEFAULT_NOTIFICATION_LINK).toBe(DEFAULT_NOTIFICATION_LINK)
  })

  it('acil (high urgency) tipler: vardiya hatırlatması ve devam uyarıları', () => {
    expect(edge.isUrgentType('shift_reminder')).toBe(true)
    expect(edge.isUrgentType('attendance_missed_clock_in')).toBe(true)
    expect(edge.isUrgentType('attendance_override')).toBe(true)
    expect(edge.isUrgentType('leave_approved')).toBe(false)
  })
})
