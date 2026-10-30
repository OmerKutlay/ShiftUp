'use client'

/**
 * HistoryPanel — "Geçmiş" sekmesi (Müdür Yardımcısı+, salt okunur): son 30 günün uygulamaları.
 * Araç çubuğu (liste + sonuç filtresi) → StatCards → DataTable (mobilde Item kartları); DESIGN_GUIDE §5.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { CircleCheck, CircleX, History, ListChecks, Timer, TriangleAlert } from 'lucide-react'

import type { ChecklistHistoryRun } from '@/types/checklist'
import { CHECKLISTS_HISTORY_KEY, fetchChecklistHistory } from '@/lib/api/checklists'
import { formatDateRangeTr } from '@/lib/dateUtils'
import { DataTable, PersonAvatar, StatCard, StatCards, StatusBadge, TableSkeleton, type ColumnDef } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemTitle } from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { clock, HISTORY_STATUS, historyStatus, type HistoryStatus } from './format'

type Row = ChecklistHistoryRun & { status: HistoryStatus }
type StatusFilter = 'all' | 'completed' | 'late' | 'missed'

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'Tüm sonuçlar',
  completed: 'Tamamlananlar',
  late: 'Geç tamamlananlar',
  missed: 'Tamamlanmayanlar',
}

const matchesStatus = (s: HistoryStatus, f: StatusFilter) =>
  f === 'all' || (f === 'completed' ? s !== 'missed' : s === f)

/** '2026-10-29' → '29 Eki, Per' (takvim günü, saat dilimi dönüşümü yok) */
const fmtDate = (d: string) => format(new Date(`${d}T12:00:00`), 'd MMM, EEE', { locale: tr })

export function HistoryPanel() {
  const { data, error } = useSWR(CHECKLISTS_HISTORY_KEY, fetchChecklistHistory)
  const [template, setTemplate] = useState('all')
  const [status, setStatus] = useState<StatusFilter>('all')

  const rows = useMemo<Row[]>(() => (data?.runs ?? []).map((r) => ({ ...r, status: historyStatus(r) })), [data])
  const templates = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) if (!map.has(r.template_id)) map.set(r.template_id, r.name)
    return [...map.entries()]
  }, [rows])

  // KPI'lar yalnızca liste filtresini izler; sonuç filtresi tabloyu daraltır
  const scoped = template === 'all' ? rows : rows.filter((r) => r.template_id === template)
  const visible = scoped.filter((r) => matchesStatus(r.status, status))
  const count = (s: HistoryStatus) => scoped.filter((r) => r.status === s).length
  const completed = scoped.length - count('missed')
  const rate = scoped.length ? Math.round((completed / scoped.length) * 100) : null

  if (error && !data) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Geçmiş yüklenemedi</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : 'Bir hata oluştu.'}</AlertDescription>
      </Alert>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)}
        </div>
        <TableSkeleton rows={8} columns={6} />
      </div>
    )
  }
  if (rows.length === 0) {
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

  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: 'date',
      accessorKey: 'run_date',
      header: 'Tarih',
      meta: { className: 'whitespace-nowrap' },
      cell: ({ row }) => fmtDate(row.original.run_date),
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Liste',
      sortingFn: (a, b) => a.original.name.localeCompare(b.original.name, 'tr'),
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.original.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {row.original.due_time ? `Son saat ${row.original.due_time.slice(0, 5)}` : 'Son saat yok'}
          </span>
        </span>
      ),
    },
    {
      id: 'progress',
      accessorFn: (r) => (r.total ? r.done / r.total : 0),
      header: 'Maddeler',
      cell: ({ row }) => <ItemsProgress run={row.original} className="w-36" />,
    },
    {
      id: 'by',
      accessorFn: (r) => r.completed_by_name ?? '',
      header: 'Tamamlayan',
      cell: ({ row }) => row.original.completed_by_name ? (
        <span className="flex items-center gap-2">
          <PersonAvatar name={row.original.completed_by_name} size={24} />
          {row.original.completed_by_name}
        </span>
      ) : <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'at',
      accessorFn: (r) => r.completed_at ?? '',
      header: 'Saat',
      meta: { className: 'tabular-nums' },
      cell: ({ row }) => clock(row.original.completed_at),
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Sonuç',
      cell: ({ row }) => <ResultBadge status={row.original.status} />,
    },
  ]

  const mobileItem = (r: Row) => (
    <Item variant="outline" size="sm" className="items-start bg-card">
      <ItemContent className="min-w-0">
        <ItemTitle>{r.name}</ItemTitle>
        <ItemDescription className="tabular-nums">
          {fmtDate(r.run_date)}
          {r.completed_at && <> · {r.completed_by_name ?? '—'} · {clock(r.completed_at)}</>}
        </ItemDescription>
      </ItemContent>
      <ItemActions><ResultBadge status={r.status} /></ItemActions>
      {/* Çubuk tam genişlikte: rozet genişliği satırdan satıra değişse de hizalı kalsın */}
      <ItemFooter><ItemsProgress run={r} className="w-full" /></ItemFooter>
    </Item>
  )

  const noMatch = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><ListChecks /></EmptyMedia>
        <EmptyTitle>Eşleşen kayıt yok</EmptyTitle>
        <EmptyDescription>Liste veya sonuç filtresini değiştirin.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select value={template} onValueChange={setTemplate}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Liste"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm listeler</SelectItem>
            {templates.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Sonuç"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((k) => (
              <SelectItem key={k} value={k}>{STATUS_FILTER_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="col-span-2 text-sm text-muted-foreground tabular-nums sm:ml-auto">
          {formatDateRangeTr(data.from, data.to)}
        </span>
      </div>

      <StatCards>
        <StatCard
          icon={<ListChecks />}
          label="Tamamlanma"
          value={rate === null ? '—' : `%${rate}`}
          badge={rate !== null && (
            <Badge tone={rate >= 95 ? 'success' : rate >= 80 ? 'warning' : 'danger'}>
              {rate >= 95 ? 'İyi' : rate >= 80 ? 'Dikkat' : 'Düşük'}
            </Badge>
          )}
          hint={`${completed} / ${scoped.length} uygulama tamamlandı`}
        />
        <StatCard
          icon={<CircleCheck />}
          label="Zamanında"
          value={count('on_time') + count('done')}
          hint="Son saatten önce tamamlanan"
        />
        <StatCard
          icon={<Timer />}
          label="Geç tamamlanan"
          value={count('late')}
          valueClassName={count('late') > 0 ? 'text-warning' : undefined}
          hint="Son saat geçtikten sonra"
        />
        <StatCard
          icon={<CircleX />}
          label="Tamamlanmadı"
          value={count('missed')}
          valueClassName={count('missed') > 0 ? 'text-destructive' : undefined}
          hint={count('missed') > 0 ? 'Gün bitti, maddeler eksik kaldı' : 'Eksik kalan liste yok'}
        />
      </StatCards>

      <DataTable
        columns={columns}
        data={visible}
        initialSorting={[{ id: 'date', desc: true }]}
        getRowId={(r) => r.id}
        renderMobileItem={mobileItem}
        empty={noMatch}
      />
    </div>
  )
}

function ResultBadge({ status }: { status: HistoryStatus }) {
  const s = HISTORY_STATUS[status]
  return <StatusBadge tone={s.tone} label={s.label} className="whitespace-nowrap" />
}

function ItemsProgress({ run, className }: { run: Pick<ChecklistHistoryRun, 'name' | 'done' | 'total'>; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Progress value={run.total ? (run.done / run.total) * 100 : 0} aria-label={`${run.name} maddeleri`} className="h-1.5" />
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{run.done}/{run.total}</span>
    </span>
  )
}
