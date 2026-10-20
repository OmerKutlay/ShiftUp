/**
 * Vardiya şablonu gösterim yardımcıları: tür (renk), süre, mola, net çalışma.
 * Hesaplar workingTimeService ile aynıdır; burada yalnızca biçimlendirilir.
 */
import type { ShiftKind } from '@/lib/workforcePlanner'
import { netWorkMins, plannedBreakMins, shiftDurationMins } from '@/lib/workingTimeService'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'

export const SHIFT_KIND_LABELS: Record<ShiftKind, string> = {
  opening: 'Açılış',
  mid: 'Ortacı',
  closing: 'Kapanış',
  full: 'Full',
  custom: 'Özel',
}

export const SHIFT_KIND_ORDER: ShiftKind[] = ['opening', 'mid', 'closing', 'full', 'custom']

/** Dakika → '7s', '7s 30d', '45d' */
export function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}d`
  return m === 0 ? `${h}s` : `${h}s ${m}d`
}

export interface ShiftTiming {
  start: string
  end: string
  kind: ShiftKind
  tone: (typeof SHIFT_KIND_TONES)[ShiftKind]
  gross: number
  breakMins: number
  net: number
  overnight: boolean
}

/** 'HH:MM[:SS]' saatlerinden tür ve süreler */
export function shiftTiming(name: string | undefined, startTime: string, endTime: string): ShiftTiming {
  const start = startTime.slice(0, 5)
  const end = endTime.slice(0, 5)
  const kind = shiftKindOf(name, start, end)
  return {
    start,
    end,
    kind,
    tone: SHIFT_KIND_TONES[kind],
    gross: shiftDurationMins(start, end),
    breakMins: plannedBreakMins(start, end),
    net: netWorkMins(start, end),
    overnight: end <= start,
  }
}
