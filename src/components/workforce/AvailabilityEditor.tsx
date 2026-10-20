'use client'
/**
 * AvailabilityEditor — İş gücü › Müsaitlik.
 *
 * Yönetici: tüm ekibin haftalık müsaitlik tablosu (gün sütunlarında saat çipleri), satırdan
 * düzenleme diyaloğu (kayıtlı aralıklar + yeni aralık formu).
 * Çalışan: yalnızca kendi haftası — gün satırları, çipten silme, günden ekleme.
 * API kuralları aynı: çalışan yalnızca kendi adına, yönetici herkes adına kayıt girer.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { CalendarClock, MoreHorizontal, Plus, Search, SquarePen, Trash2, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import type { EmployeeAvailability, DayOfWeek } from '@/types/workforce'
import { DAY_OF_WEEK_LABELS } from '@/types/workforce'
import type { EmployeeWithRole } from '@/types/employee'
import { isKioskRole } from '@/lib/auth/roles'
import { DataTable, EmployeeSelect, PersonAvatar, TableSkeleton, type ColumnDef } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from '@/components/ui/item'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { availabilityKey, fetchAvailability, hhmm } from './workforceShared'

const DAYS: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_SHORT: Record<DayOfWeek, string> = {
  monday: 'Pzt', tuesday: 'Sal', wednesday: 'Çar', thursday: 'Per', friday: 'Cum', saturday: 'Cts', sunday: 'Paz',
}

const EMPTY_FORM = { day_of_week: 'monday' as DayOfWeek, start_time: '09:00', end_time: '18:00', is_available: true, note: '' }
type AvailabilityForm = typeof EMPTY_FORM

const byDayAndTime = (a: EmployeeAvailability, b: EmployeeAvailability) =>
  DAYS.indexOf(a.day_of_week) - DAYS.indexOf(b.day_of_week) || a.start_time.localeCompare(b.start_time)

const rangeOf = (a: EmployeeAvailability) => `${hhmm(a.start_time)}–${hhmm(a.end_time)}`
const statusLabel = (a: EmployeeAvailability) => (a.is_available ? 'Müsait' : 'Müsait değil')
const normalize = (s: string) => s.toLocaleLowerCase('tr-TR')

// ─── Çip ─────────────────────────────────────────────────────

/** Saat aralığı çipi: kırmızı nokta = müsait değil, yeşil = müsait; not ve durum ipucunda */
function SlotBadge({ slot, onDelete, dayLabel }: {
  slot: EmployeeAvailability
  /** Verilirse çipte silme düğmesi görünür */
  onDelete?: () => void
  dayLabel?: string
}) {
  const badge = (
    <Badge tone={slot.is_available ? 'success' : 'danger'} className="tabular-nums" tabIndex={onDelete ? undefined : 0}>
      {rangeOf(slot)}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`${dayLabel ?? ''} ${rangeOf(slot)} kaydını sil`.trim()}
          className="-mr-1 ml-0.5 inline-flex size-4 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="size-3" />
        </button>
      )}
    </Badge>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-64">
        {statusLabel(slot)}{slot.note ? ` · ${slot.note}` : ''}
      </TooltipContent>
    </Tooltip>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-destructive" />Müsait değil</span>
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-success" />Müsait</span>
    </div>
  )
}

// ─── Ekleme / düzenleme diyaloğu ─────────────────────────────

function AvailabilityDialog({
  open, onOpenChange, title, employeeName, records, employees, employeeId, onEmployeeChange, initialDay, onAdd, onDelete,
}: {
  open: boolean
  title: string
  onOpenChange: (open: boolean) => void
  employeeName: string | null
  /** Yönetici modunda seçili çalışanın kayıtları (liste gösterilir); çalışan modunda verilmez */
  records?: EmployeeAvailability[]
  /** Verilirse diyalogda çalışan seçici görünür (yönetici, araç çubuğundan açtığında) */
  employees?: EmployeeWithRole[]
  employeeId: string
  onEmployeeChange?: (id: string) => void
  initialDay?: DayOfWeek
  onAdd: (form: AvailabilityForm) => Promise<string | null>
  onDelete: (slot: EmployeeAvailability) => Promise<void>
}) {
  const [form, setForm] = useState<AvailabilityForm>(() => ({ ...EMPTY_FORM, day_of_week: initialDay ?? EMPTY_FORM.day_of_week }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAdd = async () => {
    setSaving(true)
    setError(null)
    const err = await onAdd(form)
    setSaving(false)
    if (err) setError(err)
    else setForm((f) => ({ ...f, note: '' }))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {employeeName ? `${employeeName} · ` : ''}Planlama bu saat aralıklarını dikkate alır.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-5">
          {employees && onEmployeeChange && (
            <EmployeeSelect
              employees={employees}
              value={employeeId}
              label="Çalışan"
              onChange={onEmployeeChange}
              fullWidth
            />
          )}

          {records && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Kayıtlı aralıklar</p>
              {records.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  Bu çalışan için kayıt yok.
                </p>
              ) : (
                <ItemGroup className="max-h-60 overflow-y-auto rounded-lg border">
                  {records.map((slot, i) => (
                    <div key={slot.id}>
                      {i > 0 && <ItemSeparator />}
                      <Item size="sm" className="gap-3 rounded-none py-1.5 pr-2">
                        <ItemContent className="min-w-0 flex-row items-center gap-3">
                          <span className="w-20 shrink-0 text-sm font-medium">{DAY_OF_WEEK_LABELS[slot.day_of_week]}</span>
                          <Badge tone={slot.is_available ? 'success' : 'danger'} className="tabular-nums">{rangeOf(slot)}</Badge>
                          <span className="min-w-0 truncate text-sm text-muted-foreground" title={slot.note ?? undefined}>
                            {slot.note ?? statusLabel(slot)}
                          </span>
                        </ItemContent>
                        <ItemActions>
                          <Button
                            variant="ghost" size="icon-sm" className="text-muted-foreground"
                            aria-label={`${DAY_OF_WEEK_LABELS[slot.day_of_week]} ${rangeOf(slot)} kaydını sil`}
                            onClick={() => void onDelete(slot)}
                          >
                            <Trash2 />
                          </Button>
                        </ItemActions>
                      </Item>
                    </div>
                  ))}
                </ItemGroup>
              )}
            </div>
          )}

          {records && <FieldSeparator />}

          <FieldSet className="gap-4">
            {records && <FieldLegend variant="label">Yeni aralık</FieldLegend>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="avail-day">Gün</FieldLabel>
                <Select value={form.day_of_week} onValueChange={(v) => setForm((f) => ({ ...f, day_of_week: v as DayOfWeek }))}>
                  <SelectTrigger id="avail-day" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => <SelectItem key={d} value={d}>{DAY_OF_WEEK_LABELS[d]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="avail-start">Başlangıç</FieldLabel>
                <Input id="avail-start" type="time" step={300} value={form.start_time}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="avail-end">Bitiş</FieldLabel>
                <Input id="avail-end" type="time" step={300} value={form.end_time}
                  onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
              </Field>
            </div>
            <FieldSet className="gap-3">
              <FieldLegend variant="label">Durum</FieldLegend>
              <RadioGroup
                value={form.is_available ? 'available' : 'unavailable'}
                onValueChange={(v) => setForm((f) => ({ ...f, is_available: v === 'available' }))}
                className="grid gap-3 sm:grid-cols-2"
              >
                {([
                  ['unavailable', 'Müsait değil', 'Planlayıcı bu saatlere vardiya atamaz.', 'bg-destructive'],
                  ['available', 'Müsait', 'Bu saatlerde çalışmayı tercih eder.', 'bg-success'],
                ] as const).map(([value, title, desc, dot]) => (
                  <FieldLabel key={value} htmlFor={`avail-${value}`}>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>
                          <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
                          {title}
                        </FieldTitle>
                        <FieldDescription>{desc}</FieldDescription>
                      </FieldContent>
                      <RadioGroupItem value={value} id={`avail-${value}`} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="avail-note">Not <span className="font-normal text-muted-foreground">(isteğe bağlı)</span></FieldLabel>
              <Input id="avail-note" value={form.note} placeholder="Örn: Üniversite dersi"
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </Field>
          </FieldSet>

          {error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {records ? 'Kapat' : 'İptal'}
          </Button>
          <Button onClick={() => void handleAdd()} disabled={saving || !employeeId}>
            {saving ? <Spinner /> : <Plus />}
            {records ? 'Aralık ekle' : 'Kaydet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Ana bileşen ─────────────────────────────────────────────

interface Props {
  employees: EmployeeWithRole[]
  currentEmployeeId: string
  isManager: boolean
}

type RowFilter = 'all' | 'with' | 'without'
const ROW_FILTER_LABELS: Record<RowFilter, string> = {
  all: 'Tüm çalışanlar',
  with: 'Kaydı olanlar',
  without: 'Kaydı olmayanlar',
}

interface EmployeeRow {
  employee: EmployeeWithRole
  byDay: Record<DayOfWeek, EmployeeAvailability[]>
  count: number
}

export function AvailabilityEditor({ employees, currentEmployeeId, isManager }: Props) {
  const key = availabilityKey(isManager, currentEmployeeId)
  const availQ = useSWR(key, fetchAvailability)
  const availability = useMemo(() => [...(availQ.data?.availability ?? [])].sort(byDayAndTime), [availQ.data])
  const isFirstLoad = !availQ.data && !availQ.error

  const [query, setQuery] = useState('')
  const [rowFilter, setRowFilter] = useState<RowFilter>('all')
  // Diyalog: hangi çalışan için, hangi gün seçili açıldı
  const [dialog, setDialog] = useState<{ employeeId: string; day?: DayOfWeek; pick: boolean } | null>(null)
  const openDialog = (employeeId: string, opts: { day?: DayOfWeek; pick?: boolean } = {}) =>
    setDialog({ employeeId, day: opts.day, pick: opts.pick ?? false })

  const setAvailability = (update: (prev: EmployeeAvailability[]) => EmployeeAvailability[]) =>
    availQ.mutate((d) => ({ availability: update(d?.availability ?? []) }), { revalidate: false })

  const staff = useMemo(
    () => employees
      .filter((e) => !isKioskRole(e.roles?.access_level))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, 'tr')),
    [employees]
  )
  const nameOf = (id: string) => staff.find((e) => e.id === id)?.full_name ?? null

  const handleAdd = async (employeeId: string, form: AvailabilityForm): Promise<string | null> => {
    try {
      const res = await fetch('/api/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, employee_id: employeeId }),
      })
      const json = await res.json() as { availability: EmployeeAvailability; error?: string }
      if (!res.ok) return json.error ?? 'Kaydedilemedi.'
      setAvailability((prev) => [...prev, json.availability])
      toast.success('Müsaitlik eklendi')
      if (!isManager) setDialog(null)
      return null
    } catch {
      return 'Kaydedilemedi.'
    }
  }

  const handleDelete = async (slot: EmployeeAvailability) => {
    try {
      const res = await fetch(`/api/availability?id=${slot.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        toast.error(json.error ?? 'Silinemedi.')
        return
      }
      setAvailability((prev) => prev.filter((a) => a.id !== slot.id))
      toast.success(`${DAY_OF_WEEK_LABELS[slot.day_of_week]} ${rangeOf(slot)} kaydı silindi`)
    } catch {
      toast.error('Silinemedi.')
    }
  }

  const loadError = availQ.error && (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>Müsaitlik yüklenemedi</AlertTitle>
      <AlertDescription>{availQ.error instanceof Error ? availQ.error.message : 'Bilinmeyen hata'}</AlertDescription>
    </Alert>
  )

  const dialogNode = dialog && (
    <AvailabilityDialog
      open
      onOpenChange={(o) => { if (!o) setDialog(null) }}
      title={isManager && !dialog.pick ? 'Müsaitliği düzenle' : 'Müsaitlik ekle'}
      employeeName={isManager && !dialog.pick ? nameOf(dialog.employeeId) : null}
      records={isManager && dialog.employeeId ? availability.filter((a) => a.employee_id === dialog.employeeId) : undefined}
      employees={isManager && dialog.pick ? staff : undefined}
      employeeId={dialog.employeeId}
      onEmployeeChange={(id) => setDialog((d) => d && { ...d, employeeId: id })}
      initialDay={dialog.day}
      onAdd={(form) => handleAdd(dialog.employeeId, form)}
      onDelete={handleDelete}
    />
  )

  // ── Çalışan: kendi haftası ──
  if (!isManager) {
    const mine = availability.filter((a) => a.employee_id === currentEmployeeId)
    return (
      <div className="flex flex-col gap-4">
        {loadError}
        <Card className="gap-0 py-0 shadow-xs">
          <CardHeader className="border-b py-4 [.border-b]:pb-4">
            <CardTitle>Haftalık müsaitliğim</CardTitle>
            <CardDescription>Çalışamayacağınız saatleri girin; vardiya planlanırken dikkate alınır.</CardDescription>
            <CardAction>
              <Button size="sm" onClick={() => openDialog(currentEmployeeId)}>
                <Plus />
                Müsaitlik ekle
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0">
            {isFirstLoad ? (
              <div className="flex flex-col gap-3 p-4">
                {DAYS.map((d) => <Skeleton key={d} className="h-8 w-full" />)}
              </div>
            ) : (
              <ItemGroup>
                {DAYS.map((day, i) => {
                  const slots = mine.filter((a) => a.day_of_week === day)
                  return (
                    <div key={day}>
                      {i > 0 && <ItemSeparator />}
                      <Item size="sm" className="min-h-14 rounded-none">
                        <ItemContent className="min-w-0 flex-row flex-wrap items-center gap-x-4 gap-y-1.5">
                          <ItemTitle className="w-24 shrink-0">{DAY_OF_WEEK_LABELS[day]}</ItemTitle>
                          {slots.length === 0 ? (
                            <span className="text-sm text-muted-foreground">Kısıt yok</span>
                          ) : (
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              {slots.map((slot) => (
                                <span key={slot.id} className="inline-flex min-w-0 items-center gap-1.5">
                                  <SlotBadge slot={slot} dayLabel={DAY_OF_WEEK_LABELS[day]} onDelete={() => void handleDelete(slot)} />
                                  {slot.note && <span className="truncate text-xs text-muted-foreground">{slot.note}</span>}
                                </span>
                              ))}
                            </div>
                          )}
                        </ItemContent>
                        <ItemActions>
                          <Button
                            variant="ghost" size="icon-sm" className="text-muted-foreground"
                            onClick={() => openDialog(currentEmployeeId, { day })}
                            aria-label={`${DAY_OF_WEEK_LABELS[day]} için müsaitlik ekle`}
                          >
                            <Plus />
                          </Button>
                        </ItemActions>
                      </Item>
                    </div>
                  )
                })}
              </ItemGroup>
            )}
          </CardContent>
        </Card>
        {dialogNode}
      </div>
    )
  }

  // ── Yönetici: ekip tablosu ──
  const rows: EmployeeRow[] = staff.map((employee) => {
    const own = availability.filter((a) => a.employee_id === employee.id)
    const byDay = Object.fromEntries(DAYS.map((d) => [d, own.filter((a) => a.day_of_week === d)])) as EmployeeRow['byDay']
    return { employee, byDay, count: own.length }
  })
  const q = normalize(query.trim())
  const visibleRows = rows.filter((r) =>
    (rowFilter === 'all' || (rowFilter === 'with' ? r.count > 0 : r.count === 0)) &&
    (!q || normalize(r.employee.full_name).includes(q))
  )
  const withRecords = rows.filter((r) => r.count > 0).length

  const openFor = (employeeId: string) => openDialog(employeeId)

  const columns: ColumnDef<EmployeeRow, unknown>[] = [
    {
      id: 'employee',
      accessorFn: (r) => r.employee.full_name,
      header: 'Çalışan',
      sortingFn: (a, b) => a.original.employee.full_name.localeCompare(b.original.employee.full_name, 'tr'),
      meta: { className: 'min-w-48' },
      cell: ({ row }) => (
        <span className="flex items-center gap-2.5">
          <PersonAvatar name={row.original.employee.full_name} size={28} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.employee.full_name}</span>
            {row.original.employee.roles?.name && (
              <span className="truncate text-xs text-muted-foreground">{row.original.employee.roles.name}</span>
            )}
          </span>
        </span>
      ),
    },
    ...DAYS.map<ColumnDef<EmployeeRow, unknown>>((day) => ({
      id: day,
      header: () => <span title={DAY_OF_WEEK_LABELS[day]}>{DAY_SHORT[day]}</span>,
      enableSorting: false,
      meta: { className: 'py-2 align-middle', headerClassName: 'w-[11%]' },
      cell: ({ row }) => {
        const slots = row.original.byDay[day]
        if (slots.length === 0) return <span className="text-muted-foreground/40">—</span>
        return (
          <div className="flex flex-col items-start gap-1">
            {slots.map((slot) => <SlotBadge key={slot.id} slot={slot} />)}
          </div>
        )
      },
    })),
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-12 py-0' },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost" size="icon-sm" className="text-muted-foreground data-[state=open]:bg-muted"
              aria-label={`${row.original.employee.full_name} işlemleri`}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => openFor(row.original.employee.id)}>
              <SquarePen />
              Müsaitliği düzenle
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const mobileItem = (r: EmployeeRow) => {
    const slots = DAYS.flatMap((d) => r.byDay[d])
    return (
      <Item variant="outline" size="sm" className="items-start" onClick={() => openFor(r.employee.id)}>
        <ItemMedia><PersonAvatar name={r.employee.full_name} size={32} /></ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{r.employee.full_name}</ItemTitle>
          {slots.length === 0 ? (
            <ItemDescription>Kısıt yok</ItemDescription>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((slot) => (
                <Badge key={slot.id} tone={slot.is_available ? 'success' : 'danger'} className="tabular-nums">
                  {DAY_SHORT[slot.day_of_week]} {rangeOf(slot)}
                </Badge>
              ))}
            </div>
          )}
        </ItemContent>
        <ItemActions>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`${r.employee.full_name} müsaitliğini düzenle`}>
            <SquarePen />
          </Button>
        </ItemActions>
      </Item>
    )
  }

  const toolbar = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <InputGroup className="sm:w-60">
        <InputGroupInput placeholder="Çalışan ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Çalışan ara" />
        <InputGroupAddon><Search /></InputGroupAddon>
      </InputGroup>
      <Select value={rowFilter} onValueChange={(v) => setRowFilter(v as RowFilter)}>
        <SelectTrigger className="sm:w-48" aria-label="Kayıt durumu"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(ROW_FILTER_LABELS) as RowFilter[]).map((k) => (
            <SelectItem key={k} value={k}>{ROW_FILTER_LABELS[k]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-4 sm:ml-auto">
        <Legend />
        <Button onClick={() => openDialog('', { pick: true })} className="max-sm:flex-1">
          <Plus />
          Müsaitlik ekle
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {loadError}
      {isFirstLoad ? (
        <TableSkeleton rows={8} columns={8} />
      ) : (
        <DataTable
          columns={columns}
          data={visibleRows}
          toolbar={toolbar}
          getRowId={(r) => r.employee.id}
          onRowClick={(r) => openFor(r.employee.id)}
          renderMobileItem={mobileItem}
          empty={
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon"><CalendarClock /></EmptyMedia>
                <EmptyTitle>Çalışan bulunamadı</EmptyTitle>
                <EmptyDescription>
                  {rows.length > 0 ? 'Arama veya filtreye uyan çalışan yok.' : 'Aktif çalışan bulunmuyor.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
      )}
      {!isFirstLoad && rows.length > 0 && (
        <p className="px-1 text-sm text-muted-foreground">
          {rows.length} çalışandan {withRecords} kişinin müsaitlik kaydı var.
        </p>
      )}
      {dialogNode}
    </div>
  )
}
