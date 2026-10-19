'use client'

/**
 * usePushSubscription — bu cihazın push bildirim durumu + aç/kapat eylemleri.
 * PushPermissionCard ve PushPrompt tarafından kullanılır.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  fetchPushConfig,
  getCurrentSubscription,
  getPermissionState,
  getPushAvailability,
  subscribe,
  unsubscribe,
} from '@/lib/pwa/push'

export type PushStatus =
  | 'loading'
  | 'unsupported'
  | 'ios-needs-install'
  | 'ios-too-old'
  /** Sunucuda VAPID anahtarı tanımlı değil */
  | 'disabled'
  | 'default'
  | 'denied'
  /** İzin verilmiş ama bu cihaz abone değil (ör. çıkış sonrası) */
  | 'granted'
  | 'subscribed'

export async function resolvePushStatus(): Promise<PushStatus> {
  const availability = getPushAvailability()
  if (availability !== 'supported') return availability
  const config = await fetchPushConfig()
  if (!config.enabled) return 'disabled'
  const permission = getPermissionState()
  if (permission === 'unsupported') return 'unsupported'
  if (permission === 'denied') return 'denied'
  if (permission === 'default') return 'default'
  return (await getCurrentSubscription()) ? 'subscribed' : 'granted'
}

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setStatus(await resolvePushStatus())
  }, [])

  useEffect(() => {
    let cancelled = false
    void resolvePushStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const enable = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await subscribe()
      if (!result.ok) {
        if (result.reason === 'denied') setError(null)
        else if (result.reason === 'dismissed') setError('Bildirim izni verilmedi.')
        else if (result.reason === 'no-service-worker') {
          setError('Uygulama henüz hazır değil. Sayfayı yenileyip tekrar deneyin.')
        } else if (result.reason === 'error') setError('Bildirimler açılamadı. Lütfen tekrar deneyin.')
      }
    } finally {
      await refresh()
      setBusy(false)
    }
  }, [refresh])

  const disable = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const ok = await unsubscribe()
      if (!ok) setError('Bildirimler kapatılamadı. Lütfen tekrar deneyin.')
    } finally {
      await refresh()
      setBusy(false)
    }
  }, [refresh])

  return { status, busy, error, enable, disable, refresh }
}
