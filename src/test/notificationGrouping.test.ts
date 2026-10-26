/**
 * notificationGrouping.test.ts — API okunmamışları öne alsa da gün grupları tarih sırasında kalır.
 */
import { describe, it, expect } from 'vitest'
import { groupNotificationsByDay } from '@/components/notifications/NotificationList'
import type { Notification } from '@/types/notification'

function n(id: string, created_at: string, is_read: boolean): Notification {
  return { id, employee_id: 'e', type: 'leave_approved', title: 't', message: 'm', is_read, related_id: null, created_at }
}

describe('groupNotificationsByDay', () => {
  it('okunmamış eski bildirim yeni günün grubunu aşağı itmez', () => {
    const groups = groupNotificationsByDay([
      n('old-unread', '2026-10-20T08:00:00+00:00', false),
      n('new-read', '2026-10-22T09:00:00+00:00', true),
      n('new-read-2', '2026-10-22T07:00:00+00:00', true),
    ])
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['new-read', 'new-read-2'], ['old-unread']])
  })
})
