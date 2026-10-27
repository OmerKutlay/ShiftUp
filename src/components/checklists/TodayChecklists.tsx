'use client'

/**
 * TodayChecklists — bugünün kontrol listeleri: ilerleme kartları + madde sayfası.
 * İşaretleme SWR ile iyimser güncellenir; hata olursa geri alınır ve toast gösterilir.
 */
import { useState } from 'react'
import { useSWRConfig } from 'swr'
import { Clock, ListChecks, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import type { ChecklistRun, TodayChecklistsResponse } from '@/types/checklist'
import { CHECKLISTS_TODAY_KEY, setChecklistItemDone } from '@/lib/api/checklists'
import { useTodayChecklists } from './useTodayChecklists'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ChecklistRunSheet } from './ChecklistRunSheet'
import { applyItemToggle, clock, progress } from './format'

export function TodayChecklists() {
  const { employee } = useAuth()
  const { mutate } = useSWRConfig()
  const { data, error, mutate: reload } = useTodayChecklists()
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
        {data.runs.map((run) => <li key={run.id}><RunCard run={run} previousDay={run.run_date !== data.date} onOpen={() => setOpenId(run.id)} /></li>)}
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

function RunCard({ run, previousDay, onOpen }: { run: ChecklistRun; previousDay: boolean; onOpen: () => void }) {
  const { done, total } = progress(run)
  const complete = !!run.completed_at
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block h-full w-full rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card
        className={cn(
          'h-full gap-4 py-4 shadow-xs transition-colors hover:border-primary/40 md:py-5',
          run.overdue && 'border-destructive/40',
          complete && 'border-success/40'
        )}
      >
        <CardHeader className="px-4 md:px-5">
          <CardTitle className="break-words">{run.name}</CardTitle>
          <CardDescription className="flex items-center gap-1 tabular-nums">
            {run.due_time ? <><Clock className="size-3.5" aria-hidden />Son saat {run.due_time}</> : 'Son saat yok'}
          </CardDescription>
          <CardAction className="text-lg font-semibold tabular-nums">{done}/{total}</CardAction>
        </CardHeader>
        <CardContent className="px-4 md:px-5">
          <Progress value={total ? (done / total) * 100 : 0} aria-label={`${run.name} ilerlemesi`} />
        </CardContent>
        {(previousDay || complete || run.overdue || done > 0) && (
          <CardFooter className="flex-wrap gap-2 px-4 md:px-5">
            {previousDay && <Badge tone="neutral">Dün</Badge>}
            {complete && <Badge tone="success">Tamamlandı {clock(run.completed_at)}</Badge>}
            {run.overdue && <Badge tone="danger">Gecikti</Badge>}
            {!complete && !run.overdue && done > 0 && <Badge tone="info">Devam ediyor</Badge>}
          </CardFooter>
        )}
      </Card>
    </button>
  )
}
