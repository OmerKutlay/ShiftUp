'use client'

/**
 * useNotifications hook — FAZ 10
 * Seçili employee_id'ye ait bildirimleri yönetir.
 * Yükleme: ilk mount + employeeId değişimi + (opsiyonel) pollMs aralığıyla periyodik yenileme.
 */
import { useState, useEffect, useCallback } from 'react'
import { useLoadedKey } from './useLoadedKey'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'
import type { Notification } from '@/types/notification'
import { registerPushSignOutHook, syncSubscription } from '@/lib/pwa/push'

/** Push aboneliğinin bu sayfa oturumunda eşitlendiği çalışan (tekrar POST önlemi) */
let syncedPushFor: string | null = null

function setAppBadge(count: number) {
  if (typeof navigator === 'undefined') return
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => {})
    else void nav.clearAppBadge?.()?.catch(() => {})
  } catch {
    /* desteklenmiyor */
  }
}

export function useNotifications(employeeId: string | null, pollMs?: number) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { isFirstLoad, markLoaded } = useLoadedKey(employeeId ?? '')

  const fetch = useCallback(async () => {
    if (!employeeId) {
      setNotifications([])
      return
    }
    try {
      const res = await window.fetch(`/api/notifications?limit=30`, {
        credentials: 'same-origin',
      })
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
    fetch().finally(() => {
      setLoading(false)
      markLoaded(employeeId)
    })
  }, [employeeId, fetch, markLoaded])

  useAutoRefresh(fetch, pollMs, !!employeeId)

  // Push geldiğinde (service worker → PUSH_RECEIVED) listeyi beklemeden yenile
  useEffect(() => {
    if (!employeeId || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown } | null
      if (data && data.type === 'PUSH_RECEIVED') void fetch()
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [employeeId, fetch])

  // Push: çıkışta aboneliği kaldıran kanca + oturum başına bir kez abonelik eşitleme
  useEffect(() => {
    if (!employeeId) return
    registerPushSignOutHook()
    if (syncedPushFor === employeeId) return
    syncedPushFor = employeeId
    void syncSubscription()
  }, [employeeId])

  const unreadCount = notifications.filter((n) => !n.is_read).length
  const loaded = !!employeeId && !isFirstLoad

  // Uygulama ikonu rozeti (Badging API; destekleyen kurulu PWA'larda)
  useEffect(() => {
    if (!loaded) return
    setAppBadge(unreadCount)
  }, [loaded, unreadCount])

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
          credentials: 'same-origin',
          body: JSON.stringify({ notification_id: notificationId }),
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
        credentials: 'same-origin',

      })
    } catch {
      fetch()
    }
  }, [employeeId, fetch])

  const refresh = useCallback(() => fetch(), [fetch])

  return { notifications, unreadCount, loading, isFirstLoad, error, markAsRead, markAllAsRead, refresh }
}
