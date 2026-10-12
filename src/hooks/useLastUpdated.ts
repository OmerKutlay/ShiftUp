'use client'

import { useState } from 'react'

/**
 * Veri referansı her değiştiğinde güncellenen zaman damgası ("Son güncelleme: HH:MM").
 * Render sırasında state ayarlama deseni — effect gerekmez.
 */
export function useLastUpdated(data: unknown): Date | null {
  const [state, setState] = useState<{ data: unknown; at: Date | null }>({ data: undefined, at: null })
  if (data !== undefined && data !== state.data) setState({ data, at: new Date() })
  return state.at
}
