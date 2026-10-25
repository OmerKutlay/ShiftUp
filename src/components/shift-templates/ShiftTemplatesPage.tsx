'use client'

/**
 * ShiftTemplatesPage — Planlama › Vardiya şablonları.
 *
 * DESIGN_GUIDE iskeleti: PageHeader (+ "Yeni şablon") → gün çizelgesi kartı (aktif şablonların gün
 * içindeki yeri, tür rengiyle) → durum sekmesi + arama → DataTable (mobilde Item kartları)
 * → satır menüsü (Düzenle) → form Dialog → sonuç toast.
 */
import { useMemo, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { CalendarClock, MoreHorizontal, Plus, Search, SquarePen, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'

import type { CreateShiftTemplatePayload, ShiftTemplate, UpdateShiftTemplatePayload } from '@/types/shiftTemplate'
import { createShiftTemplate, fetchShiftTemplates, updateShiftTemplate } from '@/lib/api/shiftTemplates'
import { cn } from '@/lib/utils'
import {
  DataTable, Page, PageHeader, SegmentedControl, StatusBadge, TableSkeleton, type ColumnDef,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { ShiftTemplateFormDialog } from './ShiftTemplateFormDialog'
import { SHIFT_KIND_LABELS, SHIFT_KIND_ORDER, fmtMins, shiftTiming, type ShiftTiming } from './format'

type Row = ShiftTemplate & { timing: ShiftTiming }
type StatusFilter = 'all' | 'active' | 'inactive'

const STATUS_LABELS: Record<StatusFilter, string> = { all: 'Tümü', active: 'Aktif', inactive: 'Pasif' }
const matchesStatus = (t: ShiftTemplate, f: StatusFilter) => f === 'all' || (f === 'active' ? t.active : !t.active)
const normalize = (s: string) => s.toLocaleLowerCase('tr-TR')
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

// ─── Küçük parçalar ──────────────────────────────────────────

/** Vardiya saatleri — solda tür rengi çubuğu (Açılış amber, Ortacı mavi, Kapanış mor) */
function ShiftTime({ timing }: { timing: ShiftTiming }) {
  return (
    <span className="inline-flex items-center gap-2 tabular-nums whitespace-nowrap">
      <span aria-hidden className="h-4 w-1 rounded-full" style={{ backgroundColor: timing.tone.fill }} />
      {timing.start}–{timing.end}
    </span>
  )
}

function RowActions({ template, onEdit }: { template: ShiftTemplate; onEdit: (t: ShiftTemplate) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground data-[state=open]:bg-muted"
          aria-label={`${template.name} işlemleri`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => onEdit(template)}>
          <SquarePen />
          Düzenle
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Gün çizelgesi ───────────────────────────────────────────

function DayTimeline({ rows }: { rows: Row[] }) {
  // Eksen: en erken başlangıçtan en geç bitişe (gece yarısını geçenler ertesi güne uzar), 2 saatlik adım
  const spans = rows.map((r) => {
    const s = toMin(r.timing.start)
    return { row: r, s, e: s + r.timing.gross }
  })
  const from = Math.floor(Math.min(...spans.map((x) => x.s)) / 120) * 120
  const to = Math.ceil(Math.max(...spans.map((x) => x.e)) / 120) * 120
  const range = Math.max(to - from, 120)
  const pct = (m: number) => `${((m - from) / range) * 100}%`
  const ticks = Array.from({ length: range / 120 + 1 }, (_, i) => from + i * 120)
  const kinds = SHIFT_KIND_ORDER.filter((k) => rows.some((r) => r.timing.kind === k))

  const grid = (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {ticks.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-border" style={{ left: pct(t) }} />)}
    </div>
  )

  return (
    <Card className="gap-4 shadow-xs">
      <CardHeader>
        <CardTitle>Gün çizelgesi</CardTitle>
        <CardDescription>Aktif şablonların gün içindeki yeri</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <ul className="flex flex-col gap-1.5" aria-label="Aktif şablonlar">
          {spans.map(({ row, s }) => (
            <li key={row.id} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-sm sm:w-40" title={row.name}>{row.name}</span>
              <div className="relative h-7 flex-1">
                {grid}
                <div
                  className="absolute inset-y-0 flex min-w-0 items-center overflow-hidden rounded-md border-l-4 px-2 text-xs font-medium tabular-nums"
                  style={{
                    left: pct(s),
                    width: `${(row.timing.gross / range) * 100}%`,
                    backgroundColor: row.timing.tone.soft,
                    borderLeftColor: row.timing.tone.fill,
                    color: row.timing.tone.text,
                  }}
                >
                  <span className="truncate">{row.timing.start}–{row.timing.end}</span>
                  <span className="sr-only">, {SHIFT_KIND_LABELS[row.timing.kind]}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {/* Saat ekseni */}
        <div aria-hidden className="flex items-center gap-3">
          <span className="w-24 shrink-0 sm:w-40" />
          <div className="relative h-4 flex-1 text-xs text-muted-foreground tabular-nums">
            {ticks.map((t, i) => (
              <span
                key={t}
                className={cn(
                  'absolute top-0',
                  i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2',
                  // Dar ekranda yalnızca 4 saatte bir etiket
                  i % 2 === 1 && 'max-sm:hidden'
                )}
                style={{ left: pct(t) }}
              >
                {String((t / 60) % 24).padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>
        {/* Tür açıklaması */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:pl-43">
          {kinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-xs" style={{ backgroundColor: rows.find((r) => r.timing.kind === k)!.timing.tone.fill }} />
              {SHIFT_KIND_LABELS[k]}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Sayfa ───────────────────────────────────────────────────

export function ShiftTemplatesPage() {
  // SWR önbelleği: sayfaya dönüşte son liste hemen görünür, arka planda tazelenir
  const templatesQ = useSWR('shift-templates:all', fetchShiftTemplates)
  const templates = useMemo(() => templatesQ.data ?? [], [templatesQ.data])
  const isFirstLoad = !templatesQ.data && !templatesQ.error
  const error = templatesQ.error ? (templatesQ.error instanceof Error ? templatesQ.error.message : 'Yükleme hatası.') : null

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ShiftTemplate | null>(null)
  const [saving, setSaving] = useState(false)

  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const { mutate } = useSWRConfig()
  // Aktif şablon listesi (haftalık plan) de değişmiş olabilir
  const load = () => mutate((key) => typeof key === 'string' && key.startsWith('shift-templates:'))

  const openCreate = () => {
    setEditTarget(null)
    setDialogOpen(true)
  }

  const openEdit = (t: ShiftTemplate) => {
    setEditTarget(t)
    setDialogOpen(true)
  }

  const handleSave = async (payload: CreateShiftTemplatePayload | UpdateShiftTemplatePayload) => {
    setSaving(true)
    try {
      if (editTarget) {
        await updateShiftTemplate(editTarget.id, payload as UpdateShiftTemplatePayload)
      } else {
        await createShiftTemplate(payload as CreateShiftTemplatePayload)
      }
      setDialogOpen(false)
      toast.success(editTarget ? 'Değişiklikler kaydedildi' : `${payload.name ?? 'Şablon'} eklendi`)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const rows = useMemo<Row[]>(
    () => templates.map((t) => ({ ...t, timing: shiftTiming(t.name, t.start_time, t.end_time) })),
    [templates]
  )
  const searched = useMemo(() => {
    const q = normalize(search.trim())
    return q ? rows.filter((r) => normalize(`${r.name} ${r.description ?? ''}`).includes(q)) : rows
  }, [rows, search])
  const visible = useMemo(() => searched.filter((r) => matchesStatus(r, status)), [searched, status])
  const activeRows = useMemo(
    () => rows.filter((r) => r.active).sort((a, b) => a.timing.start.localeCompare(b.timing.start) || a.timing.gross - b.timing.gross),
    [rows]
  )
  const activeCount = activeRows.length

  // ── Tablo sütunları ──
  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Şablon',
      sortingFn: (a, b) => a.original.name.localeCompare(b.original.name, 'tr'),
      cell: ({ row }) => {
        const t = row.original
        return (
          <span className="flex min-w-0 flex-col">
            <span className={cn('truncate font-medium', !t.active && 'text-muted-foreground')}>{t.name}</span>
            {t.description && <span className="truncate text-xs text-muted-foreground">{t.description}</span>}
          </span>
        )
      },
    },
    {
      id: 'time',
      accessorFn: (t) => t.timing.start,
      header: 'Saat',
      sortingFn: (a, b) =>
        a.original.timing.start.localeCompare(b.original.timing.start) || a.original.timing.gross - b.original.timing.gross,
      cell: ({ row }) => <ShiftTime timing={row.original.timing} />,
    },
    {
      id: 'kind',
      accessorFn: (t) => SHIFT_KIND_ORDER.indexOf(t.timing.kind),
      header: 'Tür',
      meta: { className: 'text-muted-foreground' },
      cell: ({ row }) => SHIFT_KIND_LABELS[row.original.timing.kind],
    },
    {
      id: 'gross',
      accessorFn: (t) => t.timing.gross,
      header: 'Süre',
      meta: { align: 'right', className: 'tabular-nums' },
      cell: ({ row }) => fmtMins(row.original.timing.gross),
    },
    {
      id: 'break',
      accessorFn: (t) => t.timing.breakMins,
      header: 'Mola',
      meta: { align: 'right', className: 'tabular-nums text-muted-foreground' },
      cell: ({ row }) => fmtMins(row.original.timing.breakMins),
    },
    {
      id: 'net',
      accessorFn: (t) => t.timing.net,
      header: 'Net çalışma',
      meta: { align: 'right', className: 'tabular-nums font-medium' },
      cell: ({ row }) => fmtMins(row.original.timing.net),
    },
    {
      id: 'status',
      accessorKey: 'active',
      header: 'Durum',
      meta: { headerClassName: 'pl-6', className: 'pl-6' },
      cell: ({ row }) => (
        <StatusBadge tone={row.original.active ? 'success' : 'neutral'} label={row.original.active ? 'Aktif' : 'Pasif'} />
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-12 py-0' },
      cell: ({ row }) => <RowActions template={row.original} onEdit={openEdit} />,
    },
  ]

  // ── Mobil kart ──
  const mobileItem = (t: Row) => (
    <Item variant="outline" size="sm">
      <ItemMedia>
        <span aria-hidden className="h-9 w-1 rounded-full" style={{ backgroundColor: t.timing.tone.fill }} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className={cn(!t.active && 'text-muted-foreground')}>{t.name}</ItemTitle>
        <ItemDescription className="tabular-nums">
          {t.timing.start}–{t.timing.end} · {fmtMins(t.timing.gross)} · {fmtMins(t.timing.net)} net
        </ItemDescription>
      </ItemContent>
      <ItemActions className="gap-1">
        {!t.active && <StatusBadge tone="neutral" label="Pasif" />}
        <RowActions template={t} onEdit={openEdit} />
      </ItemActions>
    </Item>
  )

  const noTemplates = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><CalendarClock /></EmptyMedia>
        <EmptyTitle>Henüz vardiya şablonu eklenmemiş</EmptyTitle>
        <EmptyDescription>Açılış, Ortacı ve Kapanış gibi şablonlar haftalık planda tek tıkla atanır.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={openCreate}><Plus /> Şablon ekle</Button>
      </EmptyContent>
    </Empty>
  )
  const noMatches = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Search /></EmptyMedia>
        <EmptyTitle>Eşleşen şablon yok</EmptyTitle>
        <EmptyDescription>Arama metnini veya durum filtresini değiştirin.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={() => { setSearch(''); setStatus('all') }}>Filtreleri temizle</Button>
      </EmptyContent>
    </Empty>
  )

  const toolbar = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <SegmentedControl<StatusFilter>
        aria-label="Durum filtresi"
        value={status}
        onChange={setStatus}
        options={(['all', 'active', 'inactive'] as StatusFilter[]).map((f) => ({
          value: f,
          label: (
            <>
              {STATUS_LABELS[f]}
              <Badge variant="secondary" className="tabular-nums">{searched.filter((t) => matchesStatus(t, f)).length}</Badge>
            </>
          ),
        }))}
      />
      <InputGroup className="sm:w-64">
        <InputGroupInput
          placeholder="Şablon ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Şablon ara"
        />
        <InputGroupAddon><Search /></InputGroupAddon>
      </InputGroup>
    </div>
  )

  return (
    <Page>
      <PageHeader
        title="Vardiya şablonları"
        description={isFirstLoad
          ? <Skeleton className="h-4 w-56" />
          : `${activeCount} aktif şablon · haftalık planda tek tıkla atanır`}
        actions={
          <Button onClick={openCreate} className="max-sm:w-full">
            <Plus />
            Yeni şablon
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Şablonlar yüklenemedi</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isFirstLoad ? (
        <>
          <Skeleton className="h-72 rounded-xl" />
          <TableSkeleton rows={6} columns={6} />
        </>
      ) : !error && (
        <>
          {activeRows.length > 0 && <DayTimeline rows={activeRows} />}
          <DataTable
            columns={columns}
            data={visible}
            toolbar={templates.length > 0 ? toolbar : undefined}
            initialSorting={[{ id: 'time', desc: false }]}
            getRowId={(t) => t.id}
            renderMobileItem={mobileItem}
            pageSize={0}
            empty={templates.length === 0 ? noTemplates : noMatches}
          />
        </>
      )}

      <ShiftTemplateFormDialog
        key={dialogOpen ? editTarget?.id ?? 'new' : 'closed'}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        template={editTarget}
        loading={saving}
      />
    </Page>
  )
}
