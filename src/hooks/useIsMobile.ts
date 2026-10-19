'use client'

import { useSyncExternalStore } from 'react'

/** md kırılımının (900px) altı — globals.css'teki --breakpoint-md ile aynı */
const QUERY = '(max-width: 899.98px)'

function subscribe(onChange: () => void) {
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
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
