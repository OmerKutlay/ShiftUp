'use client'

/**
 * DailyAttendancePage — Operasyon › Günlük operasyon.
 *
 * KPI kartları → durum sekmeleri + arama → bugünün vardiyaları (DataTable; mobilde Item kartları).
 * Her satırda günün ortak saat ekseninde küçük bir zaman çizelgesi: plan, çalışma, mola ve
 * okutulmamış süre. Salt okunur — giriş / mola / çıkış yalnızca QR okutmayla işlenir.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { CalendarClock, CalendarX2, Coffee, RefreshCw, Search, TriangleAlert, UserCheck, UserX } from 'lucide-react'

import type { DailyShiftEntry } from '@/types/attendance'
import { fetchDailyShifts } from '@/lib/api/attendance'
import { formatDateTurkish, formatDayNameTurkish } from '@/lib/dateUtils'
import { useLastUpdated } from '@/hooks/useLastUpdated'
import {
  DataTable, Page, PageHeader, PersonAvatar, StatCard, StatCards, TableSkeleton, type ColumnDef,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChecklistSummaryStrip } from '@/components/checklists'
import { AttendanceStatusChip } from './AttendanceStatusChip'
import { AttendanceTimeline, TimelineAxis, TimelineLegend } from './AttendanceTimeline'
import { EmployeeAttendanceRow } from './EmployeeAttendanceRow'
import { ShiftTime } from './ShiftTime'
import { DAY_STATUS, clock, formatDelay, formatDuration, timelineRange, useNow, type DayStatus } from './attendanceTime'
import { buildDailyRows, rowPoints, type DailyRow } from './dailyRows'
import { useHydrated } from '@/hooks/useHydrated'

// ─── Durum sekmeleri ─────────────────────────────────────────

type Filter = 'all' | 'inside' | 'missing' | 'upcoming' | 'done' | 'leave'

const FILTERS: Array<{ value: Filter; label: string; match: (s: DayStatus) => boolean }> = [
  { value: 'all', label: 'Tümü', match: () => true },
  { value: 'inside', label: 'İçeride', match: (s) => s === 'working' || s === 'on_break' },
  { value: 'missing', label: 'Gelmedi', match: (s) => s === 'absent' || s === 'late' },
  { value: 'upcoming', label: 'Başlamadı', match: (s) => s === 'upcoming' },
  { value: 'done', label: 'Çıkış yaptı', match: (s) => s === 'done' },
  { value: 'leave', label: 'İzinli', match: (s) => s === 'leave' },
]

const normalize = (s: string) => s.toLocaleLowerCase('tr-TR')

/** "Gizem Aksoy", "Gizem Aksoy, Emre Çelik", "Gizem Aksoy ve 2 kişi daha" */
function names(rows: DailyRow[]): string {
  if (rows.length <= 2) return rows.map((r) => r.name).join(', ')
  return `${rows[0].name} ve ${rows.length - 1} kişi daha`
}

// ─── Sayfa ───────────────────────────────────────────────────

export function DailyAttendancePage() {
  const today = new Date()
  // Statik ön render'da bugünün tarihi / selamlama build anında sabitlenmesin
  const hydrated = useHydrated()
  const now = useNow()
  const { data, error: loadError, isValidating: loading, mutate } = useSWR('attendance:daily', fetchDailyShifts)
  const entries = useMemo<DailyShiftEntry[]>(() => data?.entries ?? [], [data])
  const isFirstLoad = !data && !loadError
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Vardiyalar yüklenemedi.') : null
  const lastRefreshed = useLastUpdated(data)
  const loadShifts = () => mutate()

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => buildDailyRows(entries, now), [entries, now])
  const range = useMemo(() => timelineRange(rowPoints(rows)), [rows])
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.value, rows.filter((r) => f.match(r.status)).length])) as Record<Filter, number>,
    [rows]
  )
  const visibleRows = useMemo(() => {
    const q = normalize(query.trim())
    const match = FILTERS.find((f) => f.value === filter)!.match
    return rows.filter((r) => match(r.status) && (!q || normalize(`${r.name} ${r.role ?? ''}`).includes(q)))
  }, [rows, filter, query])

  // ── KPI ──
  const by = (s: DayStatus) => rows.filter((r) => r.status === s)
  const working = by('working')
  const onBreak = by('on_break')
  const missing = rows.filter((r) => r.status === 'absent' || r.status === 'late')
  const lateNow = by('late')
  const planned = rows.filter((r) => r.status !== 'leave')
  const coverage = planned.length ? Math.round(((working.length + onBreak.length) / planned.length) * 100) : null
  const longestBreak = onBreak.reduce<DailyRow | null>((a, r) => {
    const t = r.entry.attendanceRecord?.break_start_at ?? ''
    return !a || t < (a.entry.attendanceRecord?.break_start_at ?? '') ? r : a
  }, null)
  const breakMins = longestBreak?.entry.attendanceRecord?.break_start_at
    ? Math.max(0, Math.floor((now - new Date(longestBreak.entry.attendanceRecord.break_start_at).getTime()) / 60_000))
    : 0

  // ── Tablo ──
  const columns: ColumnDef<DailyRow, unknown>[] = [
    {
      id: 'employee',
      accessorKey: 'name',
      header: 'Çalışan',
      sortingFn: (a, b) => a.original.name.localeCompare(b.original.name, 'tr'),
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <PersonAvatar name={row.original.name} size={32} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            <span className="truncate text-xs text-muted-foreground">{row.original.role ?? '—'}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'shift',
      accessorFn: (r) => r.win.start,
      header: 'Vardiya',
      cell: ({ row }) => <ShiftTime start={row.original.start} end={row.original.end} detail />,
    },
    {
      id: 'timeline',
      header: () => (range ? <TimelineAxis range={range} now={now} /> : 'Akış'),
      enableSorting: false,
      meta: { className: 'w-[28%] min-w-48', headerClassName: 'w-[28%] min-w-48' },
      cell: ({ row }) => range && (
        <AttendanceTimeline segments={row.original.segments} range={range} now={now} label={row.original.summary} />
      ),
    },
    {
      id: 'in',
      header: 'Giriş',
      enableSorting: false,
      cell: ({ row }) => {
        const rec = row.original.entry.attendanceRecord
        return (
          <span className="flex flex-col tabular-nums">
            <span>{clock(rec?.clock_in_at)}</span>
            {row.original.late !== null && <span className="text-xs text-warning">{formatDelay(row.original.late)} geç</span>}
          </span>
        )
      },
    },
    {
      id: 'break',
      header: 'Mola',
      enableSorting: false,
      cell: ({ row }) => {
        const rec = row.original.entry.attendanceRecord
        // break_start_at / break_end_at yalnızca son molayı tutar; öncekiler completed_break_minutes'ta
        const prev = rec?.completed_break_minutes ?? 0
        if (!rec?.break_start_at) {
          return prev > 0
            ? <span className="tabular-nums whitespace-nowrap">{formatDelay(prev)} toplam</span>
            : <span className="text-muted-foreground">—</span>
        }
        const from = new Date(rec.break_start_at).getTime()
        const to = rec.break_end_at ? new Date(rec.break_end_at).getTime() : now
        const mins = Math.max(0, Math.round((to - from) / 60_000))
        return (
          <span className="flex flex-col tabular-nums whitespace-nowrap">
            <span>{clock(rec.break_start_at)}–{rec.break_end_at ? clock(rec.break_end_at) : '…'}</span>
            {rec.break_end_at
              ? <span className="text-xs text-muted-foreground">{formatDelay(mins)}</span>
              : <span className="text-xs text-warning">{formatDelay(mins)} · sürüyor</span>}
            {prev > 0 && <span className="text-xs text-muted-foreground">Toplam {formatDelay(prev + mins)}</span>}
          </span>
        )
      },
    },
    {
      id: 'out',
      header: 'Çıkış',
      enableSorting: false,
      meta: { className: 'tabular-nums' },
      cell: ({ row }) => clock(row.original.entry.attendanceRecord?.clock_out_at),
    },
    {
      id: 'worked',
      accessorFn: (r) => r.worked ?? -1,
      header: 'Net süre',
      meta: { align: 'right', className: 'tabular-nums font-medium' },
      cell: ({ row }) => formatDuration(row.original.worked),
    },
    {
      id: 'status',
      accessorFn: (r) => DAY_STATUS[r.status].order,
      header: 'Durum',
      meta: { className: 'w-32' },
      cell: ({ row }) => <AttendanceStatusChip status={row.original.status} />,
    },
  ]

  const noRows = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><CalendarX2 /></EmptyMedia>
        <EmptyTitle>{rows.length === 0 ? 'Bugün vardiya yok' : 'Eşleşen vardiya yok'}</EmptyTitle>
        <EmptyDescription>
          {rows.length === 0
            ? 'Bugün için planlanmış vardiya bulunamadı.'
            : 'Arama veya durum filtresini değiştirin.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  return (
    <Page>
      <PageHeader
        title="Günlük operasyon"
        description={
          <>
            {hydrated ? `${formatDayNameTurkish(today)}, ${formatDateTurkish(today)}` : '\u00a0'}
            {lastRefreshed && (
              <span className="tabular-nums"> · Son güncelleme {lastRefreshed.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </>
        }
        actions={
          <Button variant="outline" onClick={() => void loadShifts()} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw />}
            Yenile
          </Button>
        }
      />

      <ChecklistSummaryStrip />

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Vardiyalar yüklenemedi</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {error}
            <Button variant="outline" size="sm" onClick={() => void loadShifts()}>Tekrar dene</Button>
          </AlertDescription>
        </Alert>
      )}

      {isFirstLoad ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)}
          </div>
          <TableSkeleton rows={8} columns={7} />
        </>
      ) : data && (
        <>
          <StatCards>
            <StatCard
              icon={<CalendarClock />}
              label="Planlanan vardiya"
              value={rows.length}
              hint={
                [counts.leave && `${counts.leave} izinli`, counts.upcoming && `${counts.upcoming} başlamadı`, counts.done && `${counts.done} çıkış yaptı`]
                  .filter(Boolean).join(' · ') || 'Tüm vardiyalar başladı'
              }
            />
            <StatCard
              icon={<UserCheck />}
              label="Çalışıyor"
              value={working.length}
              hint={coverage === null
                ? 'Bugün planlı kimse yok'
                : `İçeride ${working.length + onBreak.length} / ${planned.length} kişi (%${coverage})`}
            />
            <StatCard
              icon={<Coffee />}
              label="Molada"
              value={onBreak.length}
              valueClassName={onBreak.length > 0 ? 'text-warning' : undefined}
              hint={longestBreak
                ? `${onBreak.length > 1 ? 'En uzun: ' : ''}${longestBreak.name} · ${formatDelay(breakMins)}`
                : 'Şu an molada kimse yok'}
            />
            <StatCard
              icon={<UserX />}
              label="Gelmedi"
              value={missing.length}
              valueClassName={missing.length > 0 ? 'text-destructive' : undefined}
              hint={missing.length > 0
                ? `${names(missing)}${lateNow.length > 0 ? ` · ${lateNow.length} gecikiyor` : ''}`
                : 'Başlayan vardiyalarda eksik yok'}
            />
          </StatCards>

          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} className="gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
                <TabsList>
                  {FILTERS.map((f) => (
                    <TabsTrigger key={f.value} value={f.value}>
                      {f.label}
                      <Badge variant="secondary" className="tabular-nums">{counts[f.value]}</Badge>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <InputGroup className="lg:w-64">
                <InputGroupInput placeholder="Çalışan veya görev ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Çalışan ara" />
                <InputGroupAddon><Search /></InputGroupAddon>
              </InputGroup>
            </div>
            <DataTable
              columns={columns}
              data={visibleRows}
              pageSize={0}
              getRowId={(r) => r.id}
              renderMobileItem={(r) => <EmployeeAttendanceRow row={r} range={range} now={now} />}
              empty={noRows}
            />
            {rows.length > 0 && (
              <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
              <TimelineLegend />
                <p className="text-xs text-muted-foreground">Giriş, mola ve çıkış QR okutmayla işlenir</p>
              </div>
            )}
          </Tabs>
        </>
      )}
    </Page>
  )
}
