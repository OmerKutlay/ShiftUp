'use client'

/**
 * useNotifications hook — FAZ 10
 * Seçili employee_id'ye ait bildirimleri yönetir.
 * Yükleme: SWR (anahtar: employeeId) + (opsiyonel) pollMs aralığıyla periyodik yenileme; gizli sekmede durur.
 */
import { useEffect, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api/http'
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
  // SWR önbelleği: zil ve sayfa aynı veriyi paylaşır; sayfaya dönüşte son liste hemen görünür,
  // arka planda tazelenir ve yalnızca veri değiştiyse yeniden çizilir
  const key = employeeId ? (['notifications', employeeId] as const) : null
  const q = useSWR(key, () => apiFetch<{ notifications: Notification[] }>('/api/notifications?limit=30'), {
    refreshInterval: pollMs,
  })
  const { mutate } = q
  const notifications = useMemo(() => q.data?.notifications ?? [], [q.data])
  const error = q.error ? 'Bildirimler yüklenemedi.' : null
  const isFirstLoad = !q.data && !q.error
  const loading = q.isLoading

  const fetch = useCallback(async () => { await mutate() }, [mutate])

  /** Okundu işaretini önbellekte hemen uygular (optimistik) */
  const markLocal = useCallback(
    (match: (n: Notification) => boolean) =>
      mutate(
        (d) => d && { ...d, notifications: d.notifications.map((n) => (match(n) ? { ...n, is_read: true } : n)) },
        { revalidate: false },
      ),
    [mutate],
  )

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
  const loaded = !!employeeId && !!q.data

  // Uygulama ikonu rozeti (Badging API; destekleyen kurulu PWA'larda)
  useEffect(() => {
    if (!loaded) return
    setAppBadge(unreadCount)
  }, [loaded, unreadCount])

  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!employeeId) return
      void markLocal((n) => n.id === notificationId)
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
    [employeeId, fetch, markLocal],
  )

  const markAllAsRead = useCallback(async () => {
    if (!employeeId) return
    void markLocal(() => true)
    try {
      await window.fetch('/api/notifications/read-all', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',

      })
    } catch {
      fetch()
    }
  }, [employeeId, fetch, markLocal])

  const refresh = useCallback(() => fetch(), [fetch])

  return { notifications, unreadCount, loading, isFirstLoad, error, markAsRead, markAllAsRead, refresh }
}
