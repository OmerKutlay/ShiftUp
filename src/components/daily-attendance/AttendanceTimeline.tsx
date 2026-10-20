'use client'

/**
 * AttendanceTimeline — günün ortak saat ekseninde bir vardiyanın küçük çizelgesi.
 * Zemin: planlanan vardiya; üstünde çalışılan süre (yeşil), mola (amber), giriş okutulmamış
 * geçen süre (kırmızı). Tüm satırlar aynı ekseni kullandığından "şimdi" çizgisi hizalı durur.
 */
import { cn } from '@/lib/utils'
import { clock, type Segment, type SegmentKind, type ShiftWindow } from './attendanceTime'

const SEGMENT_CLASS: Record<SegmentKind, string> = {
  planned: 'inset-y-0 rounded-full bg-muted-foreground/15',
  leave: 'inset-y-0 rounded-full bg-info/20',
  missed: 'inset-y-0 rounded-full bg-destructive/35',
  worked: 'inset-y-0 rounded-full bg-success',
  break: 'inset-y-0 rounded-full bg-warning',
}

const pct = (t: number, range: ShiftWindow) =>
  Math.min(100, Math.max(0, ((t - range.start) / (range.end - range.start)) * 100))

export function AttendanceTimeline({ segments, range, now, label, className }: {
  segments: Segment[]
  range: ShiftWindow
  now: number
  /** Ekran okuyucu metni (ör. "Giriş 07:59, mola 11:26–12:26") */
  label: string
  className?: string
}) {
  const nowPct = now >= range.start && now <= range.end ? pct(now, range) : null
  return (
    <div role="img" aria-label={label} className={cn('relative h-5 w-full', className)}>
      <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2">
        {segments.map((s, i) => {
          const left = pct(s.from, range)
          const width = Math.max(pct(s.to, range) - left, s.to > s.from ? 0.8 : 0)
          if (width <= 0) return null
          return (
            <span
              key={i}
              aria-hidden
              className={cn('absolute', SEGMENT_CLASS[s.kind])}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          )
        })}
      </div>
      {nowPct !== null && (
        <span aria-hidden className="absolute inset-y-0 w-px bg-primary" style={{ left: `${nowPct}%` }} />
      )}
    </div>
  )
}

/** Sütun başlığındaki saat ölçeği (ör. 08 · 10 · 12 …) */
export function TimelineAxis({ range, now }: { range: ShiftWindow; now: number }) {
  const hour = 3_600_000
  const hours = Math.round((range.end - range.start) / hour)
  const step = hours > 16 ? 4 : hours > 6 ? 2 : 1
  const ticks: number[] = []
  for (let t = range.start; t <= range.end; t += step * hour) ticks.push(t)
  const nowPct = now >= range.start && now <= range.end ? pct(now, range) : null
  return (
    <div className="relative h-5 w-full text-xs font-normal text-muted-foreground tabular-nums" aria-hidden>
      {ticks.map((t, i) => (
        <span
          key={t}
          className={cn(
            'absolute top-1/2 -translate-y-1/2',
            i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'
          )}
          style={{ left: `${pct(t, range)}%` }}
        >
          {clock(t).slice(0, 2)}
        </span>
      ))}
      {nowPct !== null && (
        <span className="absolute -bottom-2.5 h-2.5 w-px bg-primary" style={{ left: `${nowPct}%` }} />
      )}
    </div>
  )
}

/** Çizelge renk açıklaması */
export function TimelineLegend({ className }: { className?: string }) {
  const items: Array<[string, string]> = [
    ['bg-success', 'Çalışma'],
    ['bg-warning', 'Mola'],
    ['bg-destructive/35', 'Giriş yok'],
    ['bg-muted-foreground/15', 'Plan'],
  ]
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground', className)}>
      {items.map(([cls, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn('h-2 w-3 rounded-full', cls)} />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-px bg-primary" />
        Şimdi
      </span>
    </div>
  )
}
