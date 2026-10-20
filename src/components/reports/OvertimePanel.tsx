'use client'

/**
 * OvertimePanel — Raporlar › Fazla çalışma: yıllık takip (İş K. Md. 41), 270 saat sınırı ve yazılı onay.
 *
 * Devam raporuyla aynı dil (DESIGN_GUIDE §9): araç çubuğu (yıl, arama, durum) → kural notu → KPI kartları →
 * aylık dağılım + en çok fazla çalışanlar grafikleri → DataTable (mobilde Item kartları).
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts'
import { CircleCheck, FileWarning, Gauge, Scale, Search, Timer, TriangleAlert, TrendingUp } from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import type { OvertimeSummary } from '@/lib/overtime'
import { ANNUAL_OVERTIME_CAP_HOURS } from '@/lib/laborLaw'
import { addDaysToDateString, formatShortDateTr, turkeyToday } from '@/lib/dateUtils'
import {
  DataTable, PersonAvatar, StatCard, StatCards, StatusBadge, TableSkeleton, type ColumnDef,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const hours = (mins: number) => (Math.round((mins / 60) * 10) / 10).toLocaleString('tr-TR')

/** Sınıra yakınlık eşiği: yıllık sınırın %80'i */
const NEAR_CAP = 0.8

type Level = 'ok' | 'near' | 'over'
const levelOf = (s: OvertimeSummary): Level => (s.overCap ? 'over' : s.capRatio >= NEAR_CAP ? 'near' : 'ok')
const LEVEL_TONE: Record<Level, BadgeTone> = { ok: 'success', near: 'warning', over: 'danger' }
const LEVEL_INDICATOR: Record<Level, string> = { ok: 'bg-primary', near: 'bg-warning', over: 'bg-destructive' }
const LEVEL_FILL: Record<Level, string> = { ok: 'var(--chart-1)', near: 'var(--warning)', over: 'var(--destructive)' }

// ─── Filtre ──────────────────────────────────────────────────

type Filter = 'all' | 'consent' | 'near' | 'over'
const FILTER_LABELS: Record<Filter, string> = {
  all: 'Tüm çalışanlar',
  consent: 'Onayı eksik',
  near: `Sınıra yakın (%${NEAR_CAP * 100}+)`,
  over: 'Sınırı aşan',
}
function matches(s: OvertimeSummary, f: Filter): boolean {
  switch (f) {
    case 'all': return true
    case 'consent': return !s.consent_at
    case 'near': return s.capRatio >= NEAR_CAP
    case 'over': return s.overCap
  }
}

const normalize = (s: string) => s.toLocaleLowerCase('tr-TR')

// ─── Küçük parçalar ──────────────────────────────────────────

function CapMeter({ s, className }: { s: OvertimeSummary; className?: string }) {
  const pct = Math.round(s.capRatio * 100)
  const level = levelOf(s)
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Progress
        value={Math.min(100, s.capRatio * 100)}
        aria-label={`Yıllık sınırın %${pct}'i`}
        className="min-w-24 flex-1 bg-muted"
        indicatorClassName={LEVEL_INDICATOR[level]}
      />
      <span className={cn(
        'w-10 shrink-0 text-right text-sm tabular-nums',
        level === 'over' ? 'font-medium text-destructive' : level === 'near' ? 'font-medium text-warning' : 'text-muted-foreground'
      )}>
        %{pct}
      </span>
    </div>
  )
}

function ConsentBadge({ s }: { s: OvertimeSummary }) {
  return s.consent_at
    ? <StatusBadge tone="success" label={`Var · ${formatShortDateTr(s.consent_at.slice(0, 10))}`} />
    : <StatusBadge tone="warning" label="Yok" />
}

// ─── Grafikler ───────────────────────────────────────────────

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

const monthlyConfig = { hours: { label: 'Fazla çalışma (s)', color: 'var(--chart-1)' } } satisfies ChartConfig
const topConfig = { hours: { label: 'Fazla çalışma (s)', color: 'var(--chart-1)' } } satisfies ChartConfig

/** Haftalar Pazar gününün ayına yazılır (puantajla aynı kural) */
function MonthlyChart({ rows, year }: { rows: OvertimeSummary[]; year: number }) {
  const data = useMemo(() => {
    const mins = Array.from({ length: 12 }, () => 0)
    for (const s of rows) {
      for (const w of s.weeks) {
        const sunday = addDaysToDateString(w.weekStart, 6)
        if (Number(sunday.slice(0, 4)) === year) mins[Number(sunday.slice(5, 7)) - 1] += w.overtimeMins
      }
    }
    return mins.map((m, i) => ({ month: MONTHS[i], hours: Math.round((m / 60) * 10) / 10 }))
  }, [rows, year])
  const today = turkeyToday()
  const current = Number(today.slice(0, 4)) === year ? Number(today.slice(5, 7)) - 1 : -1

  return (
    <Card className="gap-4 shadow-xs">
      <CardHeader>
        <CardTitle>Aylara göre</CardTitle>
        <CardDescription>
          Ekibin toplam fazla çalışması, saat{current >= 0 && ' · açık renkli çubuk: süren ay'}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer config={monthlyConfig} className="aspect-auto h-[220px] w-full">
          <BarChart data={data} margin={{ left: -16, right: 4 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <Bar dataKey="hours" fill="var(--color-hours)" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => <Cell key={d.month} fillOpacity={i === current ? 0.45 : 1} />)}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

function TopChart({ rows }: { rows: OvertimeSummary[] }) {
  const data = useMemo(
    () => [...rows]
      .sort((a, b) => b.totalOvertimeMins - a.totalOvertimeMins)
      .slice(0, 6)
      .map((s) => ({ name: s.full_name, hours: Math.round((s.totalOvertimeMins / 60) * 10) / 10, level: levelOf(s) })),
    [rows]
  )
  const max = Math.max(ANNUAL_OVERTIME_CAP_HOURS, ...data.map((d) => d.hours))
  return (
    <Card className="gap-4 shadow-xs">
      <CardHeader>
        <CardTitle>En çok fazla çalışanlar</CardTitle>
        <CardDescription>Yıllık {ANNUAL_OVERTIME_CAP_HOURS} saat sınırına göre</CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer config={topConfig} className="aspect-auto h-[220px] w-full">
          <BarChart data={data} layout="vertical" margin={{ top: 20, left: 0, right: 40 }} barCategoryGap="22%">
            <CartesianGrid horizontal={false} />
            <YAxis
              dataKey="name"
              type="category"
              tickLine={false}
              axisLine={false}
              width={112}
              tickFormatter={(v: string) => (v.length > 15 ? `${v.slice(0, 14)}…` : v)}
            />
            <XAxis type="number" domain={[0, Math.ceil(max / 30) * 30]} tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <ReferenceLine
              x={ANNUAL_OVERTIME_CAP_HOURS}
              stroke="var(--destructive)"
              strokeDasharray="4 4"
              label={{ value: `Sınır ${ANNUAL_OVERTIME_CAP_HOURS} s`, position: 'top', fill: 'var(--destructive)', fontSize: 12 }}
            />
            <Bar dataKey="hours" fill="var(--color-hours)" radius={[0, 4, 4, 0]}>
              {/* Tablodaki ilerleme çubuğuyla aynı eşik renkleri */}
              {data.map((d) => <Cell key={d.name} fill={LEVEL_FILL[d.level]} />)}
              <LabelList
                dataKey="hours"
                position="right"
                offset={8}
                className="fill-foreground tabular-nums"
                fontSize={12}
                formatter={(v: unknown) => (typeof v === 'number' ? v.toLocaleString('tr-TR') : String(v ?? ''))}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

// ─── Panel ───────────────────────────────────────────────────

export function OvertimePanel() {
  const currentYear = Number(turkeyToday().slice(0, 4))
  const [year, setYear] = useState(currentYear)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const { data, error, isLoading } = useSWR(`/api/reports/overtime?year=${year}`, (url: string) =>
    apiFetch<{ summaries: OvertimeSummary[] }>(url)
  )
  const rows = useMemo(() => (data?.summaries ?? []).filter((s) => s.totalOvertimeMins > 0), [data])
  const visible = useMemo(() => {
    const q = normalize(query.trim())
    return rows.filter((s) => matches(s, filter) && (!q || normalize(s.full_name).includes(q)))
  }, [rows, filter, query])

  const totalMins = rows.reduce((t, s) => t + s.totalOvertimeMins, 0)
  const totalWeeks = rows.reduce((t, s) => t + s.weeks.length, 0)
  const top = rows.reduce<OvertimeSummary | null>((m, s) => (!m || s.capRatio > m.capRatio ? s : m), null)
  const overCap = rows.filter((s) => s.overCap)
  const nearCap = rows.filter((s) => !s.overCap && s.capRatio >= NEAR_CAP)
  const noConsent = rows.filter((s) => !s.consent_at)

  const columns: ColumnDef<OvertimeSummary, unknown>[] = [
    {
      id: 'employee',
      accessorKey: 'full_name',
      header: 'Çalışan',
      sortingFn: (a, b) => a.original.full_name.localeCompare(b.original.full_name, 'tr'),
      cell: ({ row }) => (
        <span className="flex items-center gap-2.5">
          <PersonAvatar name={row.original.full_name} size={28} />
          <span className="font-medium">{row.original.full_name}</span>
        </span>
      ),
    },
    {
      id: 'total',
      accessorKey: 'totalOvertimeMins',
      header: 'Fazla çalışma',
      meta: { align: 'right', className: 'tabular-nums font-medium' },
      cell: ({ row }) => `${hours(row.original.totalOvertimeMins)} s`,
    },
    {
      id: 'cap',
      accessorKey: 'capRatio',
      header: `Yıllık sınır (${ANNUAL_OVERTIME_CAP_HOURS} s)`,
      meta: { className: 'min-w-56 w-[28%]' },
      cell: ({ row }) => <CapMeter s={row.original} />,
    },
    {
      id: 'left',
      accessorFn: (s) => s.capMins - s.totalOvertimeMins,
      header: 'Kalan',
      meta: { align: 'right', className: 'tabular-nums' },
      cell: ({ row }) => {
        const left = row.original.capMins - row.original.totalOvertimeMins
        return left > 0
          ? `${hours(left)} s`
          : <span className="font-medium text-destructive">{hours(-left)} s aşıldı</span>
      },
    },
    {
      id: 'weeks',
      accessorFn: (s) => s.weeks.length,
      header: 'Hafta',
      meta: { align: 'right', className: 'tabular-nums' },
    },
    {
      id: 'consent',
      accessorFn: (s) => s.consent_at ?? '',
      header: 'Yazılı onay',
      cell: ({ row }) => <ConsentBadge s={row.original} />,
    },
  ]

  const mobileItem = (s: OvertimeSummary) => (
    <Item variant="outline" size="sm" className="items-start">
      <ItemMedia><PersonAvatar name={s.full_name} size={32} /></ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{s.full_name}</ItemTitle>
        <ItemDescription className="tabular-nums">{s.weeks.length} hafta · onay {s.consent_at ? 'var' : 'yok'}</ItemDescription>
        <CapMeter s={s} className="mt-1" />
      </ItemContent>
      <ItemActions className="flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums">{hours(s.totalOvertimeMins)} s</span>
        {!s.consent_at && <Badge tone="warning">Onay yok</Badge>}
      </ItemActions>
    </Item>
  )

  const noMatch = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Search /></EmptyMedia>
        <EmptyTitle>Eşleşen çalışan yok</EmptyTitle>
        <EmptyDescription>Arama veya durum filtresini değiştirin.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  const topLevel = top ? levelOf(top) : 'ok'

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Araç çubuğu: yıl · arama · durum */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-full md:w-32" aria-label="Yıl"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <InputGroup className="md:w-56">
          <InputGroupInput placeholder="Çalışan ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Çalışan ara" />
          <InputGroupAddon><Search /></InputGroupAddon>
        </InputGroup>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-full md:w-52" aria-label="Durum"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(FILTER_LABELS) as Filter[]).map((k) => <SelectItem key={k} value={k}>{FILTER_LABELS[k]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Alert tone="info" role="note">
        <Scale />
        <AlertTitle>İş Kanunu Md. 41</AlertTitle>
        <AlertDescription>
          Haftalık 45 saati aşan net fiili çalışma fazla çalışmadır; yıllık üst sınır {ANNUAL_OVERTIME_CAP_HOURS} saat,
          ücreti %50 zamlıdır ve çalışanın yazılı onayı gerekir.
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Rapor yüklenemedi</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : 'Bilinmeyen hata'}</AlertDescription>
        </Alert>
      )}

      {isLoading && !data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)}
          </div>
          <TableSkeleton rows={6} columns={6} />
        </>
      ) : data && rows.length === 0 ? (
        <div className="rounded-lg border">
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon"><CircleCheck /></EmptyMedia>
              <EmptyTitle>Fazla çalışma yok</EmptyTitle>
              <EmptyDescription>{year} yılında fazla çalışma kaydı yok.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : data && (
        <>
          <StatCards>
            <StatCard
              icon={<Timer />}
              label="Toplam fazla çalışma"
              value={`${hours(totalMins)} s`}
              hint={`${rows.length} çalışan · ${totalWeeks} hafta`}
            />
            <StatCard
              icon={<TrendingUp />}
              label="Sınıra en yakın"
              value={top ? `%${Math.round(top.capRatio * 100)}` : '—'}
              valueClassName={topLevel === 'over' ? 'text-destructive' : topLevel === 'near' ? 'text-warning' : undefined}
              badge={top && topLevel !== 'ok' && (
                <Badge tone={LEVEL_TONE[topLevel]}>{topLevel === 'over' ? 'Aşıldı' : 'Dikkat'}</Badge>
              )}
              hint={top ? `${top.full_name} · ${hours(top.totalOvertimeMins)} / ${ANNUAL_OVERTIME_CAP_HOURS} s` : undefined}
            />
            <StatCard
              icon={<Gauge />}
              label="Sınırı aşan"
              value={overCap.length}
              valueClassName={overCap.length > 0 ? 'text-destructive' : undefined}
              hint={nearCap.length > 0 ? `${nearCap.length} kişi %${NEAR_CAP * 100} üzerinde` : `%${NEAR_CAP * 100} üzerinde kimse yok`}
            />
            <StatCard
              icon={<FileWarning />}
              label="Yazılı onay eksik"
              value={noConsent.length}
              valueClassName={noConsent.length > 0 ? 'text-warning' : undefined}
              hint={noConsent.length > 0 ? noConsent.map((s) => s.full_name).join(', ') : 'Tüm onaylar tamam'}
            />
          </StatCards>

          <div className="grid gap-4 md:gap-6 @5xl/main:grid-cols-2">
            <MonthlyChart rows={rows} year={year} />
            <TopChart rows={rows} />
          </div>

          <DataTable
            columns={columns}
            data={visible}
            initialSorting={[{ id: 'total', desc: true }]}
            getRowId={(s) => s.employee_id}
            renderMobileItem={mobileItem}
            empty={noMatch}
          />
        </>
      )}
    </div>
  )
}
