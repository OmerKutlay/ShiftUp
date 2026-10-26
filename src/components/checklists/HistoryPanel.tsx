'use client'

/**
 * HistoryPanel — "Geçmiş" sekmesi (Müdür Yardımcısı+, salt okunur): son 30 günün uygulamaları,
 * şablon başına; tamamlanma durumu, tamamlayan kişi ve saati.
 */
import { useMemo } from 'react'
import useSWR from 'swr'
import { Check, TriangleAlert } from 'lucide-react'

import type { ChecklistHistoryRun } from '@/types/checklist'
import { CHECKLISTS_HISTORY_KEY, fetchChecklistHistory } from '@/lib/api/checklists'
import { formatShortDateTr } from '@/lib/dateUtils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { clock } from './format'

export function HistoryPanel() {
  const { data, error } = useSWR(CHECKLISTS_HISTORY_KEY, fetchChecklistHistory)

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; runs: ChecklistHistoryRun[] }>()
    for (const r of data?.runs ?? []) {
      const g = map.get(r.template_id) ?? { name: r.name, runs: [] }
      g.runs.push(r)
      map.set(r.template_id, g)
    }
    return [...map.entries()]
  }, [data])

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Geçmiş yüklenemedi</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : 'Bir hata oluştu.'}</AlertDescription>
      </Alert>
    )
  }
  if (!data) return <Skeleton className="h-40 rounded-xl" />
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">Son 30 günde kayıt yok.</p>

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([templateId, g]) => (
        <section key={templateId} className="rounded-xl border bg-card shadow-xs">
          <h3 className="border-b px-4 py-3 font-semibold">{g.name}</h3>
          <ul className="divide-y">
            {g.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="tabular-nums">{formatShortDateTr(r.run_date)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground tabular-nums">{r.done}/{r.total}</span>
                  {r.completed_at ? (
                    <>
                      <Badge tone="success"><Check className="size-3" aria-hidden />Tamamlandı {clock(r.completed_at)}</Badge>
                      {r.completed_by_name && <span className="text-muted-foreground">{r.completed_by_name}</span>}
                    </>
                  ) : (
                    <Badge tone="danger">Tamamlanmadı</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
