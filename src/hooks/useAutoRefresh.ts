'use client'

/**
 * useAutoRefresh — isteğe bağlı periyodik yenileme hook'u
 *
 * Tek tetikleyici: interval (opsiyonel)
 * visibilitychange kaldırıldı — kullanıcı hiçbir işlem yapmadan
 * veri kendiliğinden yenilenmemeli; refresh yalnızca mutation sonrası olmalı.
 *
 * Kullanım:
 *   useAutoRefresh(load, 0, !dialogOpen)   // interval yok, sadece enabled kontrolü
 *   useAutoRefresh(load, 30_000, enabled)  // interval + enabled koşulu
 */
import { useEffect, useRef } from 'react'

export function useAutoRefresh(
  onRefresh: () => void,
  intervalMs?: number,
  enabled = true,
): void {
  const refreshRef = useRef(onRefresh)
  useEffect(() => { refreshRef.current = onRefresh }, [onRefresh])

  useEffect(() => {
    if (!enabled || !intervalMs) return
    const id = setInterval(() => refreshRef.current(), intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs])
}
