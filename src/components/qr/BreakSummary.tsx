'use client'

/**
 * BreakSummary — QR tara ekranında bugünkü molaların tek satırlık özeti (vardiya saatinin yanında).
 * Dokununca her mola sırasıyla (kaçıncı mola, çıkış – dönüş, süre) küçük bir pencerede açılır.
 * Süren molada amber renkte "2. mola · 12. dk" (kaçıncı dakika, canlı). Hiç mola yoksa çizilmez.
 */
import { ChevronDown, Coffee } from 'lucide-react'
import type { BreakItem } from '@/lib/attendanceDurations'
import { formatDelay, useNow } from '@/components/daily-attendance/attendanceTime'
import { BreakDetails, activeBreakLabel, breakStats, breakStatsLabel } from '@/components/daily-attendance/BreakDetails'
import { cn } from '@/lib/utils'

export function BreakSummary({ breaks }: { breaks: BreakItem[] }) {
  // Süren molanın dakikası 15 sn'de bir tazelenir
  const now = useNow(15_000)
  if (breaks.length === 0) return null
  const stats = breakStats(breaks, now)

  return (
    <BreakDetails breaks={breaks} now={now} label={breakStatsLabel(stats)} className="rounded-full">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm tabular-nums',
          stats.active && 'border-warning/40 bg-warning/10 text-warning'
        )}
      >
        <Coffee className={cn('size-3.5', !stats.active && 'text-muted-foreground')} aria-hidden />
        {stats.active
          ? `${activeBreakLabel(stats.active)} · ${stats.active.minutes + 1}. dk`
          : `${stats.count !== null ? `${stats.count} mola · ` : ''}${formatDelay(stats.total)}`}
        <ChevronDown className="size-3.5 opacity-60" aria-hidden />
      </span>
    </BreakDetails>
  )
}
