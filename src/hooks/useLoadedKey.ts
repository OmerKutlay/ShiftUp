'use client'

import { useState, useCallback } from 'react'

/**
 * useLoadedKey — Keep-alive (cacheComponents + Activity) uyumlu ilk yükleme takibi.
 *
 * Skeleton yalnızca verilen `key` (hafta, ay, filtre, seçili çalışan…) için henüz hiç
 * yükleme tamamlanmamışsa gösterilmelidir. Sayfaya geri dönüldüğünde Activity state'i
 * korur ve effect'ler yeniden çalışır; bu durumda veri ekranda kalır, arka planda tazelenir.
 * Aynı şekilde kaydet/sil sonrası yenilemelerde de ekran skeleton'a dönmez.
 *
 * Kullanım:
 *   const { isFirstLoad, markLoaded } = useLoadedKey(weekKey)
 *   const load = useCallback(async () => {
 *     try { ... } finally { setLoading(false); markLoaded(weekKey) }
 *   }, [weekKey, markLoaded])
 *   {isFirstLoad && <ListSkeleton />}
 */
export function useLoadedKey(key: string = 'default') {
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const markLoaded = useCallback((k: string = 'default') => setLoadedKey(k), [])
  return { isFirstLoad: loadedKey !== key, markLoaded }
}
