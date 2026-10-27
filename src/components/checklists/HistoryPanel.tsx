'use client'

/**
 * HistoryPanel — "Geçmiş" sekmesi (Müdür Yardımcısı+, salt okunur): son 30 günün uygulamaları,
 * şablon başına bölüm kartı (SectionCard); tamamlanma durumu, tamamlayan kişi ve saati.
 */
import { useMemo } from 'react'
import useSWR from 'swr'
import { History, TriangleAlert } from 'lucide-react'

import type { ChecklistHistoryRun } from '@/types/checklist'
import { CHECKLISTS_HISTORY_KEY, fetchChecklistHistory } from '@/lib/api/checklists'
import { formatShortDateTr } from '@/lib/dateUtils'
import { ListSkeleton, SectionCard, SectionRow } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
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
  if (!data) return <ListSkeleton count={4} avatar={false} />
  if (groups.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><History /></EmptyMedia>
          <EmptyTitle>Son 30 günde kayıt yok</EmptyTitle>
          <EmptyDescription>Kontrol listeleri uygulandıkça burada görünür.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([templateId, g]) => {
        const completed = g.runs.filter((r) => r.completed_at).length
        return (
          <SectionCard key={templateId} title={g.name} description={`${g.runs.length} günün ${completed} tanesi tamamlandı`}>
            {g.runs.map((r) => (
              <SectionRow key={r.id} className="flex-wrap justify-between gap-y-1">
                <span className="font-medium tabular-nums">{formatShortDateTr(r.run_date)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {r.completed_by_name && <span className="text-muted-foreground">{r.completed_by_name}</span>}
                  <span className="text-muted-foreground tabular-nums">{r.done}/{r.total}</span>
                  {r.completed_at
                    ? <Badge tone="success">Tamamlandı {clock(r.completed_at)}</Badge>
                    : <Badge tone="danger">Tamamlanmadı</Badge>}
                </span>
              </SectionRow>
            ))}
          </SectionCard>
        )
      })}
    </div>
  )
}
