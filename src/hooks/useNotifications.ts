'use client'

/**
 * useNotifications hook — FAZ 10
 * Seçili employee_id'ye ait bildirimleri yönetir.
 * Polling: her 30 saniyede bir yeniler.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import type { Notification } from '@/types/notification'

const POLL_INTERVAL_MS = 30_000

export function useNotifications(employeeId: string | null) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetch = useCallback(async () => {
    if (!employeeId) {
      setNotifications([])
      return
    }
    try {
      const res = await window.fetch(`/api/notifications?employee_id=${employeeId}&limit=30`)
      if (!res.ok) return
      const json = await res.json() as { notifications: Notification[] }
      setNotifications(json.notifications ?? [])
      setError(null)
    } catch {
      setError('Bildirimler yüklenemedi.')
    }
  }, [employeeId])

  useEffect(() => {
    if (!employeeId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    fetch().finally(() => setLoading(false))

    timerRef.current = setInterval(fetch, POLL_INTERVAL_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [employeeId, fetch])

  const unreadCount = notifications.filter((n) => !n.is_read).length

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!employeeId) return
      // Optimistik güncelleme
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)),
      )
      try {
        await window.fetch('/api/notifications/read', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notification_id: notificationId, employee_id: employeeId }),
        })
      } catch {
        // Başarısız olursa yeniden yükle
        fetch()
      }
    },
    [employeeId, fetch],
  )

  const markAllAsRead = useCallback(async () => {
    if (!employeeId) return
    // Optimistik güncelleme
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    try {
      await window.fetch('/api/notifications/read-all', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId }),
      })
    } catch {
      fetch()
    }
  }, [employeeId, fetch])

  const refresh = useCallback(() => fetch(), [fetch])

  return { notifications, unreadCount, loading, error, markAsRead, markAllAsRead, refresh }
}
