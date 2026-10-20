'use client'

import { useSyncExternalStore } from 'react'

/** sm kırılımının (600px) altı — telefon genişliği (globals.css --breakpoint-sm) */
const QUERY = '(max-width: 599.98px)'

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** Telefon genişliğinde mi? Sunucuda ve hydration'da false döner. */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
