'use client'

/**
 * ChecklistSummaryStrip — Günlük operasyon sayfasındaki kısa özet şeridi:
 * "Kontrol listeleri: Açılış ✓ 09:52 · Kapanış 2/9" → /checklists. Veri yüklenemezse hiçbir şey çizmez.
 */
import Link from 'next/link'
import useSWR from 'swr'
import { ListChecks } from 'lucide-react'

import { CHECKLISTS_TODAY_KEY, fetchTodayChecklists } from '@/lib/api/checklists'
import { cn } from '@/lib/utils'
import { clock, progress } from './format'

export function ChecklistSummaryStrip() {
  const { data } = useSWR(CHECKLISTS_TODAY_KEY, fetchTodayChecklists, { refreshInterval: 60_000, shouldRetryOnError: false })
  if (!data || data.runs.length === 0) return null

  return (
    <Link
      href="/checklists"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border bg-card px-4 py-2.5 text-sm shadow-xs transition-colors hover:bg-accent/40"
    >
      <ListChecks className="size-4 text-muted-foreground" aria-hidden />
      <span className="font-medium">Kontrol listeleri:</span>
      {data.runs.map((run, i) => {
        const { done, total } = progress(run)
        return (
          <span key={run.id} className={cn('tabular-nums', run.overdue && 'text-destructive')}>
            {i > 0 && <span aria-hidden className="mr-2 text-muted-foreground">·</span>}
            {run.name}{' '}
            {run.completed_at ? <span className="text-success">✓ {clock(run.completed_at)}</span> : `${done}/${total}`}
          </span>
        )
      })}
    </Link>
  )
}
