'use client'

/**
 * HolidaysPanel — resmi tatil takvimi yönetimi (Mağaza Müdürü+).
 * Dini bayram tarihleri her yıl değiştiği için yıllık olarak buradan güncellenir.
 *
 * Kart başlığında yıl seçimi + "Tatil ekle"; içerik DataTable (mobilde Item kartları).
 * Ekleme / düzenleme Dialog içinde; aynı tarih varsa sunucu kaydı günceller (upsert).
 *
 * Kapsam: "Ulusal" tatiller tüm mağazalar için geçerlidir (yalnızca Admin ekler / siler);
 * "Mağazaya özel" tatiller yalnızca aktif mağazanındır (Mağaza Müdürü+).
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { CalendarDays, CircleAlert, MoreHorizontal, Plus, SquarePen, Trash2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import type { PublicHoliday } from '@/types/holiday'
import { ACCESS } from '@/lib/auth/roles'
import { useAuth } from '@/context/AuthContext'
import { turkeyToday } from '@/lib/dateUtils'
import { DataTable, DateField, StatusBadge, TableSkeleton, useConfirm, type ColumnDef } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

const dayFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric' })
const monthFmt = new Intl.DateTimeFormat('tr-TR', { month: 'short' })
const dateFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
const weekdayFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'long' })

const toDate = (iso: string) => new Date(`${iso}T12:00:00`)

type HolidayScope = 'national' | 'store'
type HolidayForm = { date: string; name: string; half_day: boolean; scope: HolidayScope }
const EMPTY_FORM: HolidayForm = { date: '', name: '', half_day: false, scope: 'store' }

const scopeOf = (h: PublicHoliday): HolidayScope => (h.store_id ? 'store' : 'national')

// ─── Küçük parçalar ──────────────────────────────────────────

/** Gün / ay kutucuğu (takvim yaprağı) */
function DateTile({ date, muted }: { date: string; muted?: boolean }) {
  const d = toDate(date)
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 flex-col items-center justify-center rounded-md border bg-background leading-none',
        muted && 'text-muted-foreground'
      )}
    >
      <span className="text-sm font-semibold tabular-nums">{dayFmt.format(d)}</span>
      <span className="mt-0.5 text-xs text-muted-foreground">{monthFmt.format(d)}</span>
    </span>
  )
}

function KindBadge({ h }: { h: PublicHoliday }) {
  return h.half_day
    ? <StatusBadge tone="info" label="Yarım gün" />
    : <StatusBadge tone="warning" label="Tam gün" />
}

function ScopeBadge({ h }: { h: PublicHoliday }) {
  return scopeOf(h) === 'national'
    ? <StatusBadge tone="neutral" label="Ulusal" />
    : <StatusBadge tone="brand" label="Mağazaya özel" />
}

function RowActions({ h, onEdit, onRemove }: { h: PublicHoliday; onEdit: () => void; onRemove: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground data-[state=open]:bg-muted" aria-label={`${h.name} işlemleri`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onEdit}>
          <SquarePen />
          Düzenle
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onRemove}>
          <Trash2 />
          Sil
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Ekle / düzenle ──────────────────────────────────────────

function HolidayDialog({ open, initial, editing, isAdmin, storeName, onClose, onSave }: {
  open: boolean
  initial: HolidayForm
  /** Düzenlemede tarih ve kapsam sabit: aynı kayıt güncellenir */
  editing: boolean
  /** Yalnızca Admin kapsam seçebilir (Ulusal / Bu mağaza) */
  isAdmin: boolean
  storeName?: string
  onClose: () => void
  onSave: (form: HolidayForm) => Promise<void>
}) {
  const [form, setForm] = useState<HolidayForm>(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!form.date || !form.name.trim()) { setError('Tarih ve ad zorunludur.'); return }
    setSaving(true); setError(null)
    try {
      await onSave(form)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Resmi tatili düzenle' : 'Resmi tatil ekle'}</DialogTitle>
          <DialogDescription>
            Planlamada işaretlenir, puantajda RT / RTÇ olarak görünür ve yıllık izinden sayılmaz.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => { e.preventDefault(); void submit() }}
          className="flex flex-col gap-6"
        >
          <FieldGroup className="gap-5">
            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {isAdmin && (
              <Field>
                <FieldLabel htmlFor="holiday-scope">Kapsam</FieldLabel>
                <Select
                  value={form.scope}
                  onValueChange={(v) => setForm((f) => ({ ...f, scope: v as HolidayScope }))}
                  disabled={editing}
                >
                  <SelectTrigger id="holiday-scope" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store">Bu mağaza{storeName ? ` (${storeName})` : ''}</SelectItem>
                    <SelectItem value="national">Ulusal (tüm mağazalar)</SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {form.scope === 'national'
                    ? 'Tüm mağazalarda geçerli resmi tatil.'
                    : 'Yalnızca bu mağazada geçerli yerel tatil.'}
                </FieldDescription>
              </Field>
            )}
            <Field>
              <DateField
                label="Tarih"
                fullWidth
                value={form.date}
                disabled={editing}
                onChange={(v) => setForm((f) => ({ ...f, date: v }))}
              />
              {editing && <FieldDescription>Tarihi değiştirmek için kaydı silip yeniden ekleyin.</FieldDescription>}
            </Field>
            <Field data-invalid={(!!error && !form.name.trim()) || undefined}>
              <FieldLabel htmlFor="holiday-name">Ad</FieldLabel>
              <Input
                id="holiday-name"
                placeholder="Örn: Cumhuriyet Bayramı"
                value={form.name}
                autoComplete="off"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                aria-invalid={(!!error && !form.name.trim()) || undefined}
              />
              {!!error && !form.name.trim() && <FieldError>Tatilin adını yazın.</FieldError>}
            </Field>
            <Field orientation="horizontal" className="rounded-lg border p-4">
              <Checkbox
                id="holiday-half-day"
                checked={form.half_day}
                onCheckedChange={(v) => setForm((f) => ({ ...f, half_day: v === true }))}
              />
              <FieldContent>
                <FieldLabel htmlFor="holiday-half-day">Yarım gün (arife)</FieldLabel>
                <FieldDescription>Arife günleri 13:00&apos;ten itibaren tatildir.</FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>İptal</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner />}
              Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Panel ───────────────────────────────────────────────────

export function HolidaysPanel() {
  const confirm = useConfirm()
  const { employee, store } = useAuth()
  const isAdmin = employee?.roles?.access_level === ACCESS.ADMIN
  // Ulusal tatili yalnızca Admin değiştirir; mağazaya özel tatili Mağaza Müdürü+ (bu sayfaya erişenler)
  const canModify = (h: PublicHoliday) => scopeOf(h) === 'store' || isAdmin
  const today = turkeyToday()
  const year = Number(today.slice(0, 4))
  const [range] = useState({ from: `${year - 1}-01-01`, to: `${year + 1}-12-31` })
  const key = `/api/holidays?from=${range.from}&to=${range.to}`
  const { data, error, mutate, isLoading } = useSWR(key, (url: string) => apiFetch<{ holidays: PublicHoliday[] }>(url))

  const [selectedYear, setSelectedYear] = useState(String(year))
  const [dialog, setDialog] = useState<{ initial: HolidayForm; editing: boolean } | null>(null)

  const years = [year - 1, year, year + 1].map(String)
  const holidays = useMemo(
    () => (data?.holidays ?? []).filter((h) => h.date.startsWith(selectedYear)).sort((a, b) => a.date.localeCompare(b.date)),
    [data, selectedYear]
  )
  const next = holidays.find((h) => h.date >= today)
  const fullDays = holidays.filter((h) => !h.half_day).length

  const save = async (form: HolidayForm) => {
    // Admin olmayanlar her zaman mağaza kapsamında ekler
    await apiFetch('/api/holidays', { method: 'POST', body: { ...form, scope: isAdmin ? form.scope : 'store' } })
    toast.success(dialog?.editing ? 'Resmi tatil güncellendi' : 'Resmi tatil eklendi')
    setDialog(null)
    await mutate()
  }

  const remove = async (h: PublicHoliday) => {
    if (!(await confirm({
      title: 'Resmi tatil silinsin mi?',
      message: `${dateFmt.format(toDate(h.date))} — ${h.name} takvimden kaldırılacak.`,
      confirmText: 'Sil',
      tone: 'error',
    }))) return
    try {
      await apiFetch(`/api/holidays?date=${h.date}&scope=${scopeOf(h)}`, { method: 'DELETE' })
      toast.success(`${h.name} silindi`)
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Silinemedi.')
    }
  }

  const openNew = () => setDialog({ initial: EMPTY_FORM, editing: false })
  const openEdit = (h: PublicHoliday) =>
    setDialog({ initial: { date: h.date, name: h.name, half_day: h.half_day, scope: scopeOf(h) }, editing: true })

  const rowActions = (h: PublicHoliday) =>
    canModify(h)
      ? <RowActions h={h} onEdit={() => openEdit(h)} onRemove={() => void remove(h)} />
      : null

  const columns: ColumnDef<PublicHoliday, unknown>[] = [
    {
      id: 'date',
      accessorKey: 'date',
      header: 'Tarih',
      cell: ({ row }) => {
        const h = row.original
        const past = h.date < today
        return (
          <span className="flex items-center gap-3">
            <DateTile date={h.date} muted={past} />
            <span className={cn('flex flex-col', past && 'text-muted-foreground')}>
              <span className="text-muted-foreground">{weekdayFmt.format(toDate(h.date))}</span>
            </span>
          </span>
        )
      },
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Ad',
      sortingFn: (a, b) => a.original.name.localeCompare(b.original.name, 'tr'),
      cell: ({ row }) => {
        const h = row.original
        return (
          <span className={cn('inline-flex items-center gap-2 font-medium', h.date < today && 'font-normal text-muted-foreground')}>
            {h.name}
            {h === next && <Badge variant="secondary">Sıradaki</Badge>}
            {scopeOf(h) !== 'national' && <ScopeBadge h={h} />}
          </span>
        )
      },
    },
    { id: 'kind', header: 'Tür', enableSorting: false, cell: ({ row }) => <KindBadge h={row.original} /> },
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-12 py-0' },
      cell: ({ row }) => rowActions(row.original),
    },
  ]

  const mobileItem = (h: PublicHoliday) => {
    const past = h.date < today
    return (
      <Item variant="outline" size="sm">
        <ItemMedia><DateTile date={h.date} muted={past} /></ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className={cn(past && 'text-muted-foreground')}>
            {h.name}
            {h === next && <Badge variant="secondary">Sıradaki</Badge>}
          </ItemTitle>
          <ItemDescription>{weekdayFmt.format(toDate(h.date))}</ItemDescription>
        </ItemContent>
        <ItemActions className="self-start">{rowActions(h)}</ItemActions>
        <ItemFooter className="justify-start gap-2">
          <KindBadge h={h} />
          {scopeOf(h) !== 'national' && <ScopeBadge h={h} />}
        </ItemFooter>
      </Item>
    )
  }

  const empty = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><CalendarDays /></EmptyMedia>
        <EmptyTitle>{selectedYear} için resmi tatil yok</EmptyTitle>
        <EmptyDescription>Ulusal bayramları ve Diyanet takvimindeki dini bayram tarihlerini ekleyin.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={openNew}>
          <Plus />
          Tatil ekle
        </Button>
      </EmptyContent>
    </Empty>
  )

  return (
    <Card className="gap-5 shadow-xs">
      <CardHeader className="px-4 max-sm:grid-cols-1! md:px-6">
        <CardTitle className="flex items-center gap-2">
          Resmi tatiller
          {data && <Badge variant="secondary" className="tabular-nums">{holidays.length}</Badge>}
        </CardTitle>
        <CardDescription className="max-w-2xl">
          Dini bayram tarihlerini her yıl Diyanet takvimine göre kontrol edin.
          {data && holidays.length > 0 && (
            <> {fullDays} tam gün, {holidays.length - fullDays} arife{next ? `; sıradaki: ${next.name}, ${dateFmt.format(toDate(next.date))}.` : '.'}</>
          )}
        </CardDescription>
        <CardAction className="max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:mt-2 max-sm:w-full max-sm:justify-self-stretch flex gap-2">
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-28" aria-label="Yıl"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={openNew} className="flex-1 sm:flex-none">
            <Plus />
            Tatil ekle
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-4 md:px-6">
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Resmi tatiller yüklenemedi</AlertTitle>
            <AlertDescription>{error instanceof Error ? error.message : 'Bilinmeyen hata'}</AlertDescription>
          </Alert>
        )}
        {isLoading && !data && <TableSkeleton rows={6} columns={4} />}
        {data && (
          <DataTable
            columns={columns}
            data={holidays}
            pageSize={0}
            initialSorting={[{ id: 'date', desc: false }]}
            getRowId={(h) => `${scopeOf(h)}:${h.date}`}
            renderMobileItem={mobileItem}
            empty={empty}
          />
        )}
      </CardContent>

      {dialog && (
        <HolidayDialog
          key={`${dialog.editing}-${dialog.initial.scope}-${dialog.initial.date}`}
          open
          initial={dialog.initial}
          editing={dialog.editing}
          isAdmin={isAdmin}
          storeName={store?.active.name}
          onClose={() => setDialog(null)}
          onSave={save}
        />
      )}
    </Card>
  )
}
