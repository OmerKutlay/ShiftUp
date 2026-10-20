'use client'

/**
 * AttendanceReportsPage — Raporlar › Devam raporu.
 *
 * DESIGN_GUIDE örnek sayfası: araç çubuğu (dönem, çalışan, durum, arama, dışa aktar) → KPI kartları →
 * günlük devam grafiği → "Kayıtlar / Çalışan özeti" sekmeleri (DataTable). Rapor açılışta ve her
 * filtre değişiminde kendiliğinden yüklenir.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  CalendarCheck2, Clock3, Download, MoreHorizontal, Search, SquarePen, TriangleAlert, UserX, Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { endOfMonth, format, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns'
import { tr } from 'date-fns/locale'

import type { EmployeeWithRole } from '@/types/employee'
import type { AttendanceReportRow, AttendanceReportSummary, ManualAttendanceOverride } from '@/types/report'
import { fetchAttendanceReport, buildReportSummary, exportReportToCsv } from '@/lib/reportRepository'
import { fetchEmployees } from '@/lib/api/employees'
import { isKioskRole } from '@/lib/auth/roles'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import {
  DataTable, DateField, EmployeeSelect, Page, PageHeader, PersonAvatar, StatCard, StatCards, StatusBadge,
  TableSkeleton, type BadgeTone, type ColumnDef,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// ─── Biçimlendirme ───────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  shift_waiting: 'Gelmedi',
  working: 'Çalışıyor',
  on_break: 'Molada',
  working_after_break: 'Çalışıyor',
  clocked_out: 'Tamamlandı',
  on_leave: 'İzinli',
  upcoming: 'Başlamadı',
}

const STATUS_TONES: Record<string, BadgeTone> = {
  shift_waiting: 'danger',
  working: 'success',
  on_break: 'warning',
  working_after_break: 'success',
  clocked_out: 'plum',
  on_leave: 'info',
  upcoming: 'neutral',
}

function formatMinutes(mins: number | null): string {
  if (mins === null) return '—'
  return `${Math.floor(mins / 60)}s ${mins % 60}d`
}

function formatHours(mins: number): string {
  return `${(mins / 60).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} s`
}

const timeFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false })
function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : timeFmt.format(d)
}

const METHOD_LABELS: Record<string, string> = {
  qr: 'QR',
  qr_location: 'QR + konum',
  kiosk: 'Kiosk',
  manual_override: 'Manuel',
  manual_correction: 'Mesai düzeltme',
}
const methodLabel = (m: string | null) => (m ? METHOD_LABELS[m] ?? m : '—')

const day = (workDate: string) => new Date(`${workDate}T12:00:00`)
const fmtDate = (workDate: string) => format(day(workDate), 'd MMM, EEE', { locale: tr })

// ─── Dönem ön ayarları ───────────────────────────────────────

type Preset = 'today' | 'last7' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom'

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Bugün',
  last7: 'Son 7 gün',
  thisWeek: 'Bu hafta',
  thisMonth: 'Bu ay',
  lastMonth: 'Geçen ay',
  custom: 'Özel aralık',
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

function presetRange(p: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date()
  switch (p) {
    case 'today': return { from: iso(now), to: iso(now) }
    case 'last7': return { from: iso(subDays(now, 6)), to: iso(now) }
    case 'thisWeek': return { from: iso(startOfWeek(now, { weekStartsOn: 1 })), to: iso(now) }
    case 'thisMonth': return { from: iso(startOfMonth(now)), to: iso(now) }
    case 'lastMonth': {
      const m = subMonths(now, 1)
      return { from: iso(startOfMonth(m)), to: iso(endOfMonth(m)) }
    }
  }
}

// ─── Küçük parçalar ──────────────────────────────────────────

/** Vardiya saatleri — vardiya türü rengiyle (Açılış amber, Ortacı mavi, Kapanış mor) */
function ShiftTime({ row }: { row: AttendanceReportRow }) {
  const start = row.start_time.slice(0, 5)
  const end = row.end_time.slice(0, 5)
  const tone = SHIFT_KIND_TONES[shiftKindOf(row.shift_name ?? undefined, start, end)]
  return (
    <span className="inline-flex items-center gap-2 tabular-nums whitespace-nowrap">
      <span aria-hidden className="h-4 w-1 rounded-full" style={{ backgroundColor: tone.fill }} />
      {start}–{end}
    </span>
  )
}

function StatusCell({ row }: { row: AttendanceReportRow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge tone={STATUS_TONES[row.status] ?? 'neutral'} label={STATUS_LABELS[row.status] ?? row.status} />
      {row.exception_note && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Not: ${row.exception_note}`}
              className="inline-flex size-6 items-center justify-center rounded-md text-warning hover:bg-accent"
            >
              <TriangleAlert className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{row.exception_note}</TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}

function RowActions({ row, onOverride }: { row: AttendanceReportRow; onOverride: (r: AttendanceReportRow) => void }) {
  if (!row.record_id) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground data-[state=open]:bg-muted" aria-label={`${row.full_name} işlemleri`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => onOverride(row)}>
          <SquarePen />
          Manuel düzelt
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Günlük devam grafiği ────────────────────────────────────

const chartConfig = {
  // Olağan durum nötr, istisnalar renkli: göz önce gelmeyen / izinli günlere gider
  done: { label: 'Tamamlandı', color: 'var(--muted-foreground)' },
  working: { label: 'Çalışıyor', color: 'var(--success)' },
  noShow: { label: 'Gelmedi', color: 'var(--destructive)' },
  leave: { label: 'İzinli', color: 'var(--info)' },
} satisfies ChartConfig

function DailyChart({ rows }: { rows: AttendanceReportRow[] }) {
  const data = useMemo(() => {
    const byDay = new Map<string, { date: string; done: number; working: number; noShow: number; leave: number }>()
    for (const r of rows) {
      const d = byDay.get(r.work_date) ?? { date: r.work_date, done: 0, working: 0, noShow: 0, leave: 0 }
      if (r.status === 'clocked_out') d.done++
      else if (r.status === 'shift_waiting') d.noShow++
      else if (r.status === 'on_leave') d.leave++
      else if (r.status !== 'upcoming') d.working++
      byDay.set(r.work_date, d)
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [rows])

  if (data.length < 2) return null
  return (
    <Card className="gap-4 shadow-xs">
      <CardHeader>
        <CardTitle>Günlük devam</CardTitle>
        <CardDescription>Her gün planlanan vardiyaların durumu</CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
          <BarChart data={data} margin={{ left: -16, right: 4 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={16}
              tickFormatter={(v: string) => format(day(v), 'd MMM', { locale: tr })}
            />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent labelFormatter={(v) => format(day(String(v)), 'd MMMM EEEE', { locale: tr })} />}
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="done" stackId="a" fill="var(--color-done)" fillOpacity={0.35} />
            <Bar dataKey="working" stackId="a" fill="var(--color-working)" />
            <Bar dataKey="leave" stackId="a" fill="var(--color-leave)" />
            <Bar dataKey="noShow" stackId="a" fill="var(--color-noShow)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

// ─── Manuel düzeltme ─────────────────────────────────────────

function OverrideDialog({ row, onClose, onSave }: {
  row: AttendanceReportRow | null
  onClose: () => void
  onSave: (override: ManualAttendanceOverride) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!row?.record_id) return
    if (!note.trim()) {
      setError('Düzeltme sebebini yazın.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      await onSave({ record_id: row.record_id, exception_note: note.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Düzeltme kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manuel düzeltme</DialogTitle>
          {row && (
            <DialogDescription>
              {row.full_name} · {format(day(row.work_date), 'd MMMM yyyy, EEEE', { locale: tr })}
            </DialogDescription>
          )}
        </DialogHeader>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="override-note">Sebep</FieldLabel>
          <Textarea
            id="override-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Örn: Okuyucu arızası nedeniyle giriş elle işlendi."
            aria-invalid={!!error || undefined}
          />
          {error ? <FieldError>{error}</FieldError> : <FieldDescription>Not kayda ve denetim kaydına eklenir.</FieldDescription>}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>İptal</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !note.trim()}>
            {saving && <Spinner />}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Sayfa ───────────────────────────────────────────────────

type StatusFilter = 'all' | 'no_show' | 'working' | 'done' | 'leave'

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'Tüm durumlar',
  no_show: 'Gelmedi',
  working: 'Çalışıyor / molada',
  done: 'Tamamlandı',
  leave: 'İzinli',
}

function matchesStatus(r: AttendanceReportRow, f: StatusFilter): boolean {
  switch (f) {
    case 'all': return true
    case 'no_show': return r.status === 'shift_waiting'
    case 'working': return ['working', 'on_break', 'working_after_break'].includes(r.status)
    case 'done': return r.status === 'clocked_out'
    case 'leave': return r.status === 'on_leave'
  }
}

const normalize = (s: string) => s.toLocaleLowerCase('tr-TR')

/** embedded: sekmeli Raporlar sayfasının içinde (başlık ve sayfa dolgusu olmadan) */
export function AttendanceReportsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [preset, setPreset] = useState<Preset>('last7')
  const [range, setRange] = useState(() => presetRange('last7'))
  const [employeeId, setEmployeeId] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [overrideRow, setOverrideRow] = useState<AttendanceReportRow | null>(null)

  const rangeError = range.from && range.to && range.from > range.to ? 'Başlangıç tarihi bitişten sonra olamaz.' : null

  const employeesQ = useSWR('employees', fetchEmployees, { revalidateOnFocus: false })
  const employees = useMemo<EmployeeWithRole[]>(
    () => (employeesQ.data ?? []).filter((e) => !isKioskRole(e.roles?.access_level)),
    [employeesQ.data]
  )

  const reportKey = range.from && range.to && !rangeError ? ['attendance-report', range.from, range.to, employeeId] as const : null
  const reportQ = useSWR(reportKey, ([, from, to, emp]) =>
    fetchAttendanceReport({ date_from: from, date_to: to, employee_id: emp || undefined })
  )
  const rows = useMemo(() => reportQ.data ?? [], [reportQ.data])
  const summaries = useMemo(() => buildReportSummary(rows), [rows])
  const loading = !reportQ.data && !reportQ.error && !!reportKey

  const visibleRows = useMemo(() => {
    const q = normalize(query.trim())
    return rows.filter((r) => matchesStatus(r, statusFilter) && (!q || normalize(r.full_name).includes(q)))
  }, [rows, statusFilter, query])
  const visibleSummaries = useMemo(() => {
    const q = normalize(query.trim())
    return q ? summaries.filter((s) => normalize(s.full_name).includes(q)) : summaries
  }, [summaries, query])

  const totals = summaries.reduce(
    (t, s) => ({
      attended: t.attended + s.attended_shifts,
      expected: t.expected + s.expected_shifts,
      done: t.done + s.clocked_out_count,
      noShow: t.noShow + s.no_show_count,
      worked: t.worked + s.total_worked_minutes,
      leave: t.leave + s.on_leave_count,
    }),
    { attended: 0, expected: 0, done: 0, noShow: 0, worked: 0, leave: 0 }
  )
  const attendanceRate = totals.expected > 0 ? Math.round((totals.attended / totals.expected) * 100) : null
  const noShowPeople = summaries.filter((s) => s.no_show_count > 0).length

  const choosePreset = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') setRange(presetRange(p))
  }

  const handleExport = () => {
    const blob = new Blob([exportReportToCsv(visibleRows)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shiftup-devam-${range.from}-${range.to}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleOverrideSave = async (override: ManualAttendanceOverride) => {
    const res = await fetch('/api/attendance/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(override),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new Error(data.error ?? 'Düzeltme kaydedilemedi.')
    toast.success(`${overrideRow?.full_name ?? 'Kayıt'} güncellendi`)
    setOverrideRow(null)
    await reportQ.mutate()
  }

  // ── Tablo sütunları ──
  const rowColumns: ColumnDef<AttendanceReportRow, unknown>[] = [
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
      id: 'date',
      accessorKey: 'work_date',
      header: 'Tarih',
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{fmtDate(row.original.work_date)}</span>,
    },
    { id: 'shift', header: 'Vardiya', enableSorting: false, cell: ({ row }) => <ShiftTime row={row.original} /> },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Durum',
      cell: ({ row }) => <StatusCell row={row.original} />,
    },
    {
      id: 'in',
      header: 'Giriş',
      enableSorting: false,
      meta: { className: 'tabular-nums' },
      cell: ({ row }) => formatTime(row.original.clock_in_at),
    },
    {
      id: 'out',
      header: 'Çıkış',
      enableSorting: false,
      meta: { className: 'tabular-nums' },
      cell: ({ row }) => formatTime(row.original.clock_out_at),
    },
    {
      id: 'worked',
      accessorFn: (r) => r.worked_minutes ?? -1,
      header: 'Net çalışma',
      meta: { align: 'right', className: 'tabular-nums font-medium' },
      cell: ({ row }) => formatMinutes(row.original.worked_minutes),
    },
    {
      id: 'method',
      header: 'Doğrulama',
      enableSorting: false,
      meta: { className: 'text-muted-foreground' },
      cell: ({ row }) => methodLabel(row.original.verification_method),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-12 py-0' },
      cell: ({ row }) => <RowActions row={row.original} onOverride={setOverrideRow} />,
    },
  ]

  const summaryColumns: ColumnDef<AttendanceReportSummary, unknown>[] = [
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
    { accessorKey: 'total_shifts', header: 'Vardiya', meta: { align: 'right', className: 'tabular-nums' } },
    {
      id: 'attendance',
      accessorFn: (s) => (s.expected_shifts ? s.attended_shifts / s.expected_shifts : 1),
      header: 'Katılım',
      meta: { align: 'right', className: 'tabular-nums' },
      cell: ({ row }) => `${row.original.attended_shifts}/${row.original.expected_shifts}`,
    },
    { accessorKey: 'clocked_out_count', header: 'Tamamlanan', meta: { align: 'right', className: 'tabular-nums' } },
    {
      accessorKey: 'no_show_count',
      header: 'Gelmedi',
      meta: { align: 'right', className: 'tabular-nums' },
      cell: ({ row }) => (
        <span className={cn(row.original.no_show_count > 0 && 'font-medium text-destructive')}>{row.original.no_show_count}</span>
      ),
    },
    { accessorKey: 'on_leave_count', header: 'İzinli', meta: { align: 'right', className: 'tabular-nums' } },
    {
      accessorKey: 'total_worked_minutes',
      header: 'Net çalışma',
      meta: { align: 'right', className: 'tabular-nums font-medium' },
      cell: ({ row }) => formatMinutes(row.original.total_worked_minutes),
    },
  ]

  // ── Mobil kartlar ──
  const rowItem = (r: AttendanceReportRow) => (
    <Item variant="outline" size="sm" className="items-start">
      <ItemMedia><PersonAvatar name={r.full_name} size={32} /></ItemMedia>
      <ItemContent>
        <ItemTitle>{r.full_name}</ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{fmtDate(r.work_date)}</span>
          <ShiftTime row={r} />
          <span className="tabular-nums">{formatTime(r.clock_in_at)}–{formatTime(r.clock_out_at)}</span>
          <span className="font-medium text-foreground tabular-nums">{formatMinutes(r.worked_minutes)}</span>
        </ItemDescription>
      </ItemContent>
      <ItemActions className="flex-col items-end gap-1">
        <StatusCell row={r} />
        <RowActions row={r} onOverride={setOverrideRow} />
      </ItemActions>
    </Item>
  )
  const summaryItem = (s: AttendanceReportSummary) => (
    <Item variant="outline" size="sm">
      <ItemMedia><PersonAvatar name={s.full_name} size={32} /></ItemMedia>
      <ItemContent>
        <ItemTitle>{s.full_name}</ItemTitle>
        <ItemDescription>
          {s.attended_shifts}/{s.expected_shifts} katılım · {s.clocked_out_count} tamamlanan
          {s.no_show_count > 0 && <span className="text-destructive"> · {s.no_show_count} gelmedi</span>}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="font-medium tabular-nums">{formatMinutes(s.total_worked_minutes)}</ItemActions>
    </Item>
  )

  const noData = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><CalendarCheck2 /></EmptyMedia>
        <EmptyTitle>Kayıt bulunamadı</EmptyTitle>
        <EmptyDescription>
          {rows.length > 0 ? 'Filtrelere uyan kayıt yok. Arama veya durum filtresini değiştirin.' : 'Seçilen dönemde planlanmış vardiya yok.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  const toolbar = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <InputGroup className="sm:w-60">
        <InputGroupInput placeholder="Çalışan ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Çalışan ara" />
        <InputGroupAddon><Search /></InputGroupAddon>
      </InputGroup>
      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
        <SelectTrigger className="sm:w-48" aria-label="Durum"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((k) => (
            <SelectItem key={k} value={k}>{STATUS_FILTER_LABELS[k]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  const content = (
    <>
      {/* Filtre çubuğu: dönem + çalışan; rapor kendiliğinden yenilenir */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <Select value={preset} onValueChange={(v) => choosePreset(v as Preset)}>
          <SelectTrigger className="md:w-40" aria-label="Dönem"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => <SelectItem key={p} value={p}>{PRESET_LABELS[p]}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2 md:flex">
          <DateField
            label="Başlangıç"
            hideLabel
            value={range.from}
            onChange={(v) => { setPreset('custom'); setRange((r) => ({ ...r, from: v })) }}
            max={range.to || undefined}
            className="md:w-44"
          />
          <DateField
            label="Bitiş"
            hideLabel
            value={range.to}
            onChange={(v) => { setPreset('custom'); setRange((r) => ({ ...r, to: v })) }}
            min={range.from || undefined}
            className="md:w-44"
          />
        </div>
        <EmployeeSelect
          employees={employees}
          value={employeeId}
          label="Çalışan"
          hideLabel
          emptyLabel="Tüm çalışanlar"
          onChange={setEmployeeId}
          className="md:w-56"
        />
        <Button variant="outline" onClick={handleExport} disabled={visibleRows.length === 0} className="md:ml-auto">
          <Download />
          CSV indir
        </Button>
      </div>

      {rangeError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{rangeError}</AlertDescription>
        </Alert>
      )}
      {reportQ.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Rapor yüklenemedi</AlertTitle>
          <AlertDescription>{reportQ.error instanceof Error ? reportQ.error.message : 'Bilinmeyen hata'}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)}
          </div>
          <TableSkeleton rows={8} columns={7} />
        </>
      ) : reportQ.data && (
        <>
          <StatCards>
            <StatCard
              icon={<Users />}
              label="Katılım oranı"
              value={attendanceRate === null ? '—' : `%${attendanceRate}`}
              badge={attendanceRate !== null && (
                <Badge tone={attendanceRate >= 95 ? 'success' : attendanceRate >= 85 ? 'warning' : 'danger'}>
                  {attendanceRate >= 95 ? 'İyi' : attendanceRate >= 85 ? 'Dikkat' : 'Düşük'}
                </Badge>
              )}
              hint={`${totals.attended} / ${totals.expected} vardiyada giriş yapıldı`}
            />
            <StatCard
              icon={<Clock3 />}
              label="Net çalışma"
              value={formatHours(totals.worked)}
              hint={`${summaries.length} çalışan · ${totals.done} tamamlanan vardiya`}
            />
            <StatCard
              icon={<UserX />}
              label="Gelmedi"
              value={totals.noShow}
              valueClassName={totals.noShow > 0 ? 'text-destructive' : undefined}
              hint={totals.noShow > 0 ? `${noShowPeople} kişide devamsızlık` : 'Devamsızlık yok'}
            />
            <StatCard
              icon={<CalendarCheck2 />}
              label="İzinli vardiya"
              value={totals.leave}
              hint="Onaylı izin ve hafta tatili"
            />
          </StatCards>

          <DailyChart rows={rows} />

          <Tabs defaultValue="rows">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <TabsList>
                <TabsTrigger value="rows">
                  Kayıtlar <Badge variant="secondary" className="tabular-nums">{visibleRows.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="summary">
                  Çalışan özeti <Badge variant="secondary" className="tabular-nums">{visibleSummaries.length}</Badge>
                </TabsTrigger>
              </TabsList>
              {toolbar}
            </div>
            <TabsContent value="rows" className="mt-1">
              <DataTable
                columns={rowColumns}
                data={visibleRows}
                initialSorting={[{ id: 'date', desc: true }]}
                getRowId={(r, i) => `${r.employee_id}-${r.work_date}-${i}`}
                renderMobileItem={rowItem}
                empty={noData}
              />
            </TabsContent>
            <TabsContent value="summary" className="mt-1">
              <DataTable
                columns={summaryColumns}
                data={visibleSummaries}
                getRowId={(s) => s.employee_id}
                renderMobileItem={summaryItem}
                empty={noData}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      <OverrideDialog key={overrideRow ? `${overrideRow.record_id}` : 'none'} row={overrideRow} onClose={() => setOverrideRow(null)} onSave={handleOverrideSave} />
    </>
  )

  if (embedded) return <div className="flex flex-col gap-4 md:gap-6">{content}</div>
  return (
    <Page>
      <PageHeader title="Devam raporu" description="Dönem ve çalışana göre giriş-çıkış kayıtları" />
      {content}
    </Page>
  )
}
