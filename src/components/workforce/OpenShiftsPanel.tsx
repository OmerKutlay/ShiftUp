'use client'
/**
 * OpenShiftsPanel — açık vardiya havuzu (İş gücü sekmesi ve /open-shifts).
 *
 * Rol bazlı görünüm:
 *   Yönetici (manager+): Açık vardiya oluşturabilir, iptal edebilir. Claim yapamaz.
 *   Çalışan:             Açık vardiyaları görür ve kendi adına üstlenebilir.
 *                        "Üstlen" butonu her zaman SESSION'daki çalışan adına işlem yapar —
 *                        UI'da çalışan seçici yoktur.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { Ban, BriefcaseBusiness, Check, Lock, MoreHorizontal, Plus, TriangleAlert } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import type { OpenShift } from '@/types/workforce'
import { useAuth } from '@/context/AuthContext'
import { ACCESS, hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { fetchRoles } from '@/lib/api/employees'
import { shiftDurationMins } from '@/lib/workingTimeService'
import {
  DataTable, DateField, PersonAvatar, StatusBadge, TableSkeleton, useConfirm, type BadgeTone, type ColumnDef,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { matchesRoleNeeded } from '@/lib/openShiftEligibility'
import {
  KindBar, SHIFT_KIND_LABELS, fetchOpenShifts, fmtDay, fmtDuration, hhmm, kindOf, openShiftsKey, relativeDay,
} from './workforceShared'

type StatusFilter = 'open' | 'filled' | 'cancelled'

const STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  filled: 'Dolduruldu',
  cancelled: 'İptal edildi',
}
const STATUS_TONES: Record<string, BadgeTone> = {
  open: 'warning',
  filled: 'success',
  cancelled: 'neutral',
}
const FILTER_LABELS: Record<StatusFilter, string> = {
  open: 'Açık vardiyalar',
  filled: 'Doldurulanlar',
  cancelled: 'İptal edilenler',
}

const ANY_ROLE = '__any__'
const todayIso = () => format(new Date(), 'yyyy-MM-dd')
const EMPTY_FORM = { work_date: '', start_time: '09:00', end_time: '18:00', role_needed: '', description: '' }
type OpenShiftForm = typeof EMPTY_FORM

const timeRange = (s: OpenShift) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}`

// ─── Oluşturma diyaloğu (yönetici) ───────────────────────────

function CreateOpenShiftDialog({ open, onOpenChange, roleNames, onCreate }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roleNames: string[]
  onCreate: (form: OpenShiftForm) => Promise<string | null>
}) {
  const [form, setForm] = useState<OpenShiftForm>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [dateError, setDateError] = useState(false)
  const [saving, setSaving] = useState(false)

  const valid = /^\d{2}:\d{2}/.test(form.start_time) && /^\d{2}:\d{2}/.test(form.end_time)
  const kind = valid ? kindOf(form.start_time, form.end_time) : null
  const mins = valid ? shiftDurationMins(form.start_time, form.end_time) : 0

  const handleCreate = async () => {
    if (!form.work_date) { setDateError(true); return }
    setSaving(true)
    setError(null)
    const err = await onCreate(form)
    setSaving(false)
    if (err) setError(err)
    else setForm(EMPTY_FORM)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) { onOpenChange(o); if (!o) { setError(null); setDateError(false) } } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Açık vardiya ekle</DialogTitle>
          <DialogDescription>
            Vardiya açık havuza eklenir; uygun çalışanlar kendi hesaplarından üstlenebilir.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-5">
          <Field data-invalid={dateError || undefined}>
            <DateField
              label="Tarih"
              value={form.work_date}
              onChange={(v) => { setDateError(false); setForm((f) => ({ ...f, work_date: v })) }}
              error={dateError}
              helperText={dateError ? 'Tarih zorunludur.' : undefined}
              fullWidth
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="os-start">Başlangıç</FieldLabel>
              <Input id="os-start" type="time" step={300} value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="os-end">Bitiş</FieldLabel>
              <Input id="os-end" type="time" step={300} value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
            </Field>
            {kind && mins > 0 && (
              <FieldDescription className="-mt-2 flex items-center gap-2 sm:col-span-2">
                <KindBar kind={kind} className="h-3.5 self-center" />
                {SHIFT_KIND_LABELS[kind]} vardiyası · {fmtDuration(mins)}
              </FieldDescription>
            )}
          </div>
          <Field>
            <FieldLabel htmlFor="os-role">Gerekli rol</FieldLabel>
            {/* Radix Select boş değeri kabul etmez — "Herkes" için yer tutucu */}
            <Select value={form.role_needed || ANY_ROLE}
              onValueChange={(v) => setForm((f) => ({ ...f, role_needed: v === ANY_ROLE ? '' : v }))}>
              <SelectTrigger id="os-role" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_ROLE}>Herkes</SelectItem>
                {roleNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
            <FieldDescription>Yalnızca bu roldeki çalışanlar üstlenebilir.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="os-desc">Açıklama <span className="font-normal text-muted-foreground">(isteğe bağlı)</span></FieldLabel>
            <Textarea id="os-desc" rows={2} value={form.description} placeholder="Örn: Kampanya haftası ek kasiyer"
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          {error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>İptal</Button>
          <Button onClick={() => void handleCreate()} disabled={saving}>
            {saving && <Spinner />}
            Oluştur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Panel ───────────────────────────────────────────────────

export function OpenShiftsPanel() {
  const { employee: authEmployee } = useAuth()
  const isManager = hasRole(
    authEmployee?.roles?.access_level ?? null,
    MANAGER_ROLES
  )
  const confirm = useConfirm()
  const myRoleName = authEmployee?.roles?.name ?? null

  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  // Gerekli rol: sistem rolü adlarından seçilir (üstlenme kontrolü rol adıyla eşleşir)
  const rolesQ = useSWR(isManager ? 'roles' : null, fetchRoles)
  const roleNames = (rolesQ.data ?? []).filter((r) => r.access_level !== ACCESS.KIOSK).map((r) => r.name)
  const shiftsQ = useSWR(openShiftsKey(statusFilter), fetchOpenShifts)
  const shifts = shiftsQ.data?.open_shifts ?? []
  const isFirstLoad = !shiftsQ.data && !shiftsQ.error
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  // Oluşturma/iptal/üstlenme sonrası önbellekteki liste yerinde güncellenir (yeniden çekmeden)
  const setShifts = (update: (prev: OpenShift[]) => OpenShift[]) =>
    shiftsQ.mutate((d) => ({ open_shifts: update(d?.open_shifts ?? []) }), { revalidate: false })

  // ── Açık vardiya oluştur (yönetici) ─────────────────────────
  const handleCreate = async (form: OpenShiftForm): Promise<string | null> => {
    try {
      const res = await fetch('/api/open-shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          work_date: form.work_date,
          start_time: form.start_time,
          end_time: form.end_time,
          role_needed: form.role_needed || null,
          description: form.description || null,
        }),
      })
      const json = (await res.json()) as { open_shift: OpenShift; error?: string }
      if (!res.ok) return json.error ?? 'Kaydedilemedi.'
      // Yeni vardiya "open" filtresindeyse listeye ekle
      if (statusFilter === 'open') {
        setShifts((prev) => [json.open_shift, ...prev])
      }
      setDialogOpen(false)
      toast.success('Açık vardiya oluşturuldu', { description: `${fmtDay(json.open_shift.work_date)} · ${timeRange(json.open_shift)}` })
      return null
    } catch {
      return 'Kaydedilemedi.'
    }
  }

  // ── Vardiyayı iptal et (yönetici) ────────────────────────────
  const handleCancel = async (shift: OpenShift) => {
    if (!(await confirm({
      title: 'Açık vardiya iptal edilsin mi?',
      message: `${fmtDay(shift.work_date, 'd MMMM EEEE')} ${timeRange(shift)} vardiyası havuzdan kaldırılır.`,
      confirmText: 'Vardiyayı iptal et',
      cancelText: 'Vazgeç',
      tone: 'error',
    }))) return
    setCancellingId(shift.id)
    try {
      const res = await fetch('/api/open-shifts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: shift.id, status: 'cancelled' }),
      })
      const json = (await res.json()) as { open_shift: OpenShift; error?: string }
      if (!res.ok) { toast.error(json.error ?? 'İptal edilemedi.'); return }
      setShifts((prev) => prev.map((s) => (s.id === shift.id ? json.open_shift : s)))
      toast.success('Açık vardiya iptal edildi')
    } catch {
      toast.error('İşlem başarısız.')
    } finally {
      setCancellingId(null)
    }
  }

  // ── Vardiyayı üstlen (çalışan — session üzerinden) ───────────
  const handleClaim = async (shiftId: string) => {
    setClaimingId(shiftId)
    try {
      const res = await fetch('/api/open-shifts/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ open_shift_id: shiftId }),
      })
      const json = (await res.json()) as { open_shift: OpenShift; error?: string }
      if (!res.ok) { toast.error(json.error ?? 'Üstlenme başarısız.'); return }
      setShifts((prev) => prev.map((s) => (s.id === shiftId ? json.open_shift : s)))
      toast.success('Vardiya üstlenildi', { description: 'Vardiya takviminize eklendi.' })
    } catch {
      toast.error('İşlem başarısız.')
    } finally {
      setClaimingId(null)
    }
  }

  // ── Parçalar ──
  const actions = (shift: OpenShift) => {
    if (shift.status !== 'open') return null
    if (!isManager) {
      // Sunucu bu durumlarda üstlenmeyi zaten reddeder; düğme yerine nedenini göster
      if (shift.work_date < todayIso()) {
        return <span className="text-sm text-muted-foreground">Süresi geçti</span>
      }
      if (!matchesRoleNeeded(shift.role_needed, myRoleName)) {
        return (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="size-3.5" />
            Yalnızca {shift.role_needed}
          </span>
        )
      }
      const busy = claimingId === shift.id
      return (
        <Button variant="outline" size="sm" onClick={() => void handleClaim(shift.id)} disabled={busy}>
          {busy ? <Spinner /> : <Check />}
          Üstlen
        </Button>
      )
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost" size="icon-sm" className="text-muted-foreground data-[state=open]:bg-muted"
            aria-label={`${fmtDay(shift.work_date)} ${timeRange(shift)} işlemleri`}
            disabled={cancellingId === shift.id}
          >
            {cancellingId === shift.id ? <Spinner /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem variant="destructive" onClick={() => void handleCancel(shift)}>
            <Ban />
            Vardiyayı iptal et
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const roleCell = (shift: OpenShift) => shift.role_needed
    ? <Badge variant="secondary">{shift.role_needed}</Badge>
    : <span className="text-muted-foreground">Herkes</span>

  const columns: ColumnDef<OpenShift, unknown>[] = [
    {
      id: 'date',
      accessorFn: (s) => `${s.work_date} ${s.start_time}`,
      header: 'Tarih',
      cell: ({ row }) => {
        const s = row.original
        return (
          <span className="flex items-center gap-3">
            <KindBar kind={kindOf(s.start_time, s.end_time)} className="h-8 self-center" />
            <span className="flex flex-col">
              <span className="font-medium">{fmtDay(s.work_date, 'd MMMM EEEE')}</span>
              <span className="text-xs text-muted-foreground">{relativeDay(s.work_date)}</span>
            </span>
          </span>
        )
      },
    },
    {
      id: 'time',
      header: 'Vardiya',
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original
        const kind = kindOf(s.start_time, s.end_time)
        return (
          <span className="flex flex-col">
            <span className="font-medium tabular-nums">{timeRange(s)}</span>
            <span className="text-xs text-muted-foreground">
              {SHIFT_KIND_LABELS[kind]} · {fmtDuration(shiftDurationMins(s.start_time, s.end_time))}
            </span>
          </span>
        )
      },
    },
    { id: 'role', header: 'Gerekli rol', enableSorting: false, cell: ({ row }) => roleCell(row.original) },
    {
      id: 'description',
      header: 'Açıklama',
      enableSorting: false,
      meta: { className: 'max-w-72 whitespace-normal' },
      cell: ({ row }) => row.original.description
        ? <span className="line-clamp-2 text-muted-foreground" title={row.original.description}>{row.original.description}</span>
        : <span className="text-muted-foreground">—</span>,
    },
    ...(statusFilter === 'filled' ? [{
      id: 'filled',
      header: 'Üstlenen',
      enableSorting: false,
      cell: ({ row }) => row.original.filled_by_employee ? (
        <span className="flex items-center gap-2">
          <PersonAvatar name={row.original.filled_by_employee.full_name} size={24} />
          <span className="font-medium">{row.original.filled_by_employee.full_name}</span>
        </span>
      ) : <span className="text-muted-foreground">—</span>,
    } satisfies ColumnDef<OpenShift, unknown>] : []),
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Durum',
      cell: ({ row }) => (
        <StatusBadge tone={STATUS_TONES[row.original.status] ?? 'neutral'} label={STATUS_LABELS[row.original.status] ?? row.original.status} />
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-12 py-0' },
      cell: ({ row }) => actions(row.original),
    },
  ]

  const mobileItem = (s: OpenShift) => (
    <Item variant="outline" size="sm" className="items-stretch">
      <KindBar kind={kindOf(s.start_time, s.end_time)} />
      <ItemContent className="min-w-0">
        <ItemTitle>{fmtDay(s.work_date, 'd MMM EEEE')}</ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground tabular-nums">{timeRange(s)}</span>
          <span aria-hidden>·</span>
          <span>{relativeDay(s.work_date)}</span>
          <span aria-hidden>·</span>
          <span>{s.role_needed ?? 'Herkes'}</span>
          {s.filled_by_employee && <><span aria-hidden>·</span><span className="text-foreground">{s.filled_by_employee.full_name}</span></>}
        </ItemDescription>
        {s.description && <ItemDescription className="line-clamp-2">{s.description}</ItemDescription>}
      </ItemContent>
      {/* Liste duruma göre süzülü: "Açık" rozeti yalnızca açık olmayanlarda gösterilir */}
      <ItemActions className="self-start">
        {s.status !== 'open' && (
          <StatusBadge tone={STATUS_TONES[s.status] ?? 'neutral'} label={STATUS_LABELS[s.status] ?? s.status} />
        )}
        {actions(s)}
      </ItemActions>
    </Item>
  )

  const toolbar = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
        <SelectTrigger className="sm:w-48" aria-label="Durum"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((k) => <SelectItem key={k} value={k}>{FILTER_LABELS[k]}</SelectItem>)}
        </SelectContent>
      </Select>
      {isManager ? (
        <Button onClick={() => setDialogOpen(true)} className="sm:ml-auto">
          <Plus />
          Açık vardiya ekle
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground sm:ml-auto">
          Üstlendiğiniz vardiya doğrudan takviminize eklenir.
        </p>
      )}
    </div>
  )

  const empty = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BriefcaseBusiness /></EmptyMedia>
        <EmptyTitle>
          {statusFilter === 'open' ? 'Şu an açık vardiya yok' : statusFilter === 'filled' ? 'Doldurulan vardiya yok' : 'İptal edilen vardiya yok'}
        </EmptyTitle>
        <EmptyDescription>
          {statusFilter === 'open'
            ? isManager
              ? 'Eksik kalan bir vardiyayı havuza ekleyin; çalışanlar kendi hesaplarından üstlenebilir.'
              : 'Yeni bir açık vardiya oluşturulduğunda burada görünür.'
            : 'Bu durumda vardiya bulunamadı.'}
        </EmptyDescription>
      </EmptyHeader>
      {isManager && statusFilter === 'open' && (
        <EmptyContent>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus />
            Açık vardiya ekle
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )

  return (
    <div className="flex flex-col gap-4">
      {shiftsQ.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Açık vardiyalar yüklenemedi</AlertTitle>
          <AlertDescription>{shiftsQ.error instanceof Error ? shiftsQ.error.message : 'Bilinmeyen hata'}</AlertDescription>
        </Alert>
      )}

      {isFirstLoad ? (
        <div className="flex flex-col gap-3">
          {toolbar}
          <TableSkeleton rows={5} columns={6} />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={shifts}
          toolbar={toolbar}
          initialSorting={[{ id: 'date', desc: false }]}
          getRowId={(s) => s.id}
          renderMobileItem={mobileItem}
          empty={empty}
        />
      )}

      {/* Açık vardiya oluşturma diyaloğu — yalnızca yönetici */}
      {isManager && (
        <CreateOpenShiftDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          roleNames={roleNames}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
