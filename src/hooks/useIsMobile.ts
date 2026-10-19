'use client'

import { useSyncExternalStore } from 'react'

/** md kırılımının (900px) altı — globals.css'teki --breakpoint-md ile aynı */
const QUERY = '(max-width: 899.98px)'

// matchMedia olmayan ortamlar (jsdom testleri) masaüstü sayılır
const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribe(onChange: () => void) {
  if (!hasMatchMedia()) return () => {}
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/**
 * Telefon / dar ekran mı? Sunucuda ve ilk istemci render'ında false döner (hydration uyumu),
 * ardından gerçek değere geçer.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hasMatchMedia() && window.matchMedia(QUERY).matches,
    () => false,
  )
}
