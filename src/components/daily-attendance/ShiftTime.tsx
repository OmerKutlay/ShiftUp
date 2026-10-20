'use client'

/**
 * ShiftTime — vardiya saatleri, solda vardiya türü renginde ince çubuk
 * (Açılış amber, Ortacı mavi, Kapanış mor; DESIGN_GUIDE §2). `detail` ile altta tür ve süre.
 */
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { cn } from '@/lib/utils'

const KIND_LABELS = { opening: 'Açılış', mid: 'Ortacı', closing: 'Kapanış', full: 'Tam gün', custom: 'Özel' } as const

function durationLabel(start: string, end: string): string {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  let mins = toMin(end) - toMin(start)
  if (mins <= 0) mins += 1440
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}s ${m}d` : `${h} s`
}

export function ShiftTime({ start, end, detail = false, className }: {
  start: string
  end: string
  detail?: boolean
  className?: string
}) {
  const s = start.slice(0, 5)
  const e = end.slice(0, 5)
  const kind = shiftKindOf(undefined, s, e)
  const tone = SHIFT_KIND_TONES[kind]
  return (
    <span className={cn('inline-flex items-center gap-2 whitespace-nowrap', className)}>
      <span aria-hidden className={cn('w-1 shrink-0 rounded-full', detail ? 'h-8' : 'h-4')} style={{ backgroundColor: tone.fill }} />
      <span className="flex flex-col">
        <span className="tabular-nums">{s}–{e}</span>
        {detail && <span className="text-xs text-muted-foreground">{KIND_LABELS[kind]} · {durationLabel(s, e)}</span>}
      </span>
    </span>
  )
}
