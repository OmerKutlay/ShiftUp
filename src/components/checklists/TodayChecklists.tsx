'use client'

/**
 * TodayChecklists — bugünün kontrol listeleri: ilerleme kartları + madde sayfası.
 * İşaretleme SWR ile iyimser güncellenir; hata olursa geri alınır ve toast gösterilir.
 */
import { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { Clock, ListChecks, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import type { ChecklistRun, TodayChecklistsResponse } from '@/types/checklist'
import { CHECKLISTS_TODAY_KEY, fetchTodayChecklists, setChecklistItemDone } from '@/lib/api/checklists'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ChecklistRunSheet } from './ChecklistRunSheet'
import { applyItemToggle, clock, progress } from './format'

export function TodayChecklists() {
  const { employee } = useAuth()
  const { mutate } = useSWRConfig()
  const { data, error, mutate: reload } = useSWR(CHECKLISTS_TODAY_KEY, fetchTodayChecklists, { refreshInterval: 60_000 })
  const [openId, setOpenId] = useState<string | null>(null)
  const openRun = data?.runs.find((r) => r.id === openId) ?? null

  async function toggle(runId: string, itemId: string, done: boolean) {
    if (!data || !employee) return
    const actor = { id: employee.id, name: employee.full_name }
    const optimistic = applyItemToggle(data, runId, itemId, done, actor, new Date().toISOString())
    try {
      await mutate<TodayChecklistsResponse>(
        CHECKLISTS_TODAY_KEY,
        async (current) => {
          const r = await setChecklistItemDone(runId, itemId, done)
          const base = current ?? optimistic
          // Sunucunun kesin değerleri (zaman damgaları, tamamlanma) iyimser sonucun üstüne yazılır
          return {
            ...base,
            runs: base.runs.map((run) => run.id !== runId ? run : {
              ...run,
              items: run.items.map((i) => i.id === itemId ? { ...i, done_at: r.item.done_at, done_by: r.item.done_by } : i),
              completed_at: r.completed_at,
              completed_by_name: r.completed_at ? run.completed_by_name ?? actor.name : null,
            }),
          }
        },
        { optimisticData: optimistic, rollbackOnError: true, populateCache: true, revalidate: false }
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'İşaretlenemedi.')
      void reload()
    }
  }

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Kontrol listeleri yüklenemedi</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          {error instanceof Error ? error.message : 'Bir hata oluştu.'}
          <Button variant="outline" size="sm" onClick={() => void reload()}>Tekrar dene</Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    )
  }

  if (data.runs.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><ListChecks /></EmptyMedia>
          <EmptyTitle>Bugün için kontrol listesi yok</EmptyTitle>
          <EmptyDescription>
            {data.is_manager
              ? 'Şablonlar sekmesinden açılış, kapanış ya da özel bir liste ekleyebilirsiniz.'
              : 'Bugün bu mağaza için planlanmış bir liste bulunmuyor.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.runs.map((run) => <li key={run.id}><RunCard run={run} onOpen={() => setOpenId(run.id)} /></li>)}
      </ul>
      <ChecklistRunSheet
        run={openRun}
        onClose={() => setOpenId(null)}
        canTick={data.can_tick}
        isManager={data.is_manager}
        currentEmployeeId={data.current_employee_id}
        onToggle={(runId, itemId, done) => void toggle(runId, itemId, done)}
      />
    </>
  )
}

function RunCard({ run, onOpen }: { run: ChecklistRun; onOpen: () => void }) {
  const { done, total } = progress(run)
  const complete = !!run.completed_at
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors outline-none',
        'hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        run.overdue && 'border-destructive/40',
        complete && 'border-success/40'
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-base font-semibold break-words">{run.name}</span>
        <span className="text-lg font-semibold tabular-nums">{done}/{total}</span>
      </span>
      <Progress value={total ? (done / total) * 100 : 0} aria-label={`${run.name} ilerlemesi`} />
      <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {run.due_time && (
          <span className="inline-flex items-center gap-1 tabular-nums"><Clock className="size-3.5" aria-hidden />Son saat {run.due_time}</span>
        )}
        {complete && <Badge tone="success">Tamamlandı {clock(run.completed_at)}</Badge>}
        {run.overdue && <Badge tone="danger">Gecikti</Badge>}
        {!complete && !run.overdue && done > 0 && <Badge tone="info">Devam ediyor</Badge>}
      </span>
    </button>
  )
}
