'use client'

/**
 * ChecklistSummaryStrip — Günlük operasyon sayfasındaki kısa özet satırı (shadcn Item):
 * "Kontrol listeleri: Açılış ✓ 09:52 · Kapanış 2/9" → /checklists. Veri yüklenemezse hiçbir şey çizmez.
 */
import Link from 'next/link'
import { ChevronRight, ListChecks } from 'lucide-react'

import { useTodayChecklists } from './useTodayChecklists'
import { cn } from '@/lib/utils'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { clock, progress } from './format'

export function ChecklistSummaryStrip() {
  const { data } = useTodayChecklists()
  if (!data || data.runs.length === 0) return null

  return (
    <Item variant="outline" size="sm" asChild className="bg-card shadow-xs">
      <Link href="/checklists">
        <ItemMedia variant="icon"><ListChecks /></ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>Kontrol listeleri</ItemTitle>
          <ItemDescription className="flex flex-wrap gap-x-2 gap-y-0.5">
            {data.runs.map((run, i) => {
              const { done, total } = progress(run)
              return (
                <span key={run.id} className={cn('tabular-nums', run.overdue && 'text-destructive')}>
                  {i > 0 && <span aria-hidden className="mr-2">·</span>}
                  {run.name}{' '}
                  {run.completed_at ? <span className="text-success">✓ {clock(run.completed_at)}</span> : `${done}/${total}`}
                </span>
              )
            })}
          </ItemDescription>
        </ItemContent>
        <ItemActions><ChevronRight className="size-4 text-muted-foreground" aria-hidden /></ItemActions>
      </Link>
    </Item>
  )
}
