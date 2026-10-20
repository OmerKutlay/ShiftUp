'use client'
/**
 * ShiftSwapPanel — vardiya takas talepleri: liste (talep eden → karşı taraf), yeni talep, onay/red.
 *
 * Takas bir taleptir: çalışan kendi vardiyası için talep açar, önce karşı taraf kabul eder,
 * vardiyalar ancak bir yöneticinin (Müdür Yardımcısı+) onayıyla değişir.
 * Çalışan kendi bekleyen talebini iptal edebilir.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { ArrowLeftRight, ArrowRight, Check, Info, Plus, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'
import type { ShiftSwapRequest, CreateSwapRequestPayload } from '@/types/workforce'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import type { EmployeeWithRole } from '@/types/employee'
import {
  DataTable, PersonAvatar, StatusBadge, TableSkeleton, useConfirm, type BadgeTone, type ColumnDef,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Item, ItemContent, ItemFooter } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SHIFT_KIND_LABELS, SWAPS_KEY, ShiftChip, fetchSwaps, fmtDay, hhmm, kindOf, relativeDay } from './workforceShared'

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  awaiting_target: { label: 'Karşı taraf bekleniyor', tone: 'info' },
  pending: { label: 'Yönetici onayı bekliyor', tone: 'warning' },
  approved: { label: 'Onaylandı', tone: 'success' },
  rejected: { label: 'Reddedildi', tone: 'danger' },
  cancelled: { label: 'İptal edildi', tone: 'neutral' },
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'
const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'Tüm talepler',
  pending: 'Bekleyenler',
  approved: 'Onaylananlar',
  rejected: 'Reddedilenler',
  cancelled: 'İptal edilenler',
}

/** Radix Select boş değer kabul etmez — "karşılık vardiya yok" seçeneği için yer tutucu */
const NO_TARGET_SHIFT = '__none__'

type ReviewStatus = 'accepted' | 'declined' | 'approved' | 'rejected' | 'cancelled'

const REVIEW_TOASTS: Record<ReviewStatus, string> = {
  accepted: 'Teklif kabul edildi; yönetici onayı bekleniyor',
  declined: 'Teklif reddedildi',
  approved: 'Takas onaylandı; vardiyalar güncellendi',
  rejected: 'Takas talebi reddedildi',
  cancelled: 'Takas talebi iptal edildi',
}

interface Props {
  employees: EmployeeWithRole[]
  assignments: ShiftAssignmentWithDetails[]
  currentEmployeeId: string | null
  isManager: boolean
}

type ShiftLike = { work_date: string; start_time: string; end_time: string }

/** Kullanıcının bu talepte yapabilecekleri — sayfa sekme sayacı da aynı kuralı kullanır */
export function swapPermissions(swap: ShiftSwapRequest, currentEmployeeId: string | null, isManager: boolean) {
  const isPending = swap.status === 'pending'
  const awaitingTarget = isPending && !swap.target_accepted_at
  const isParty = swap.requester_id === currentEmployeeId || swap.target_id === currentEmployeeId
  return {
    awaitingTarget,
    // Önce hedef çalışan kabul eder; sonra tarafı olmayan bir yönetici onaylar/reddeder
    canRespond: awaitingTarget && swap.target_id === currentEmployeeId,
    canReview: isPending && !awaitingTarget && isManager && !isParty,
    canCancel: isPending && swap.requester_id === currentEmployeeId,
  }
}

// ─── Parçalar ────────────────────────────────────────────────

/** Takasın bir tarafı: avatar + ad + vardiya çipi */
function Party({ name, shift, emptyShift }: { name: string; shift: ShiftLike | null | undefined; emptyShift: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar name={name} size={32} />
      <div className="flex min-w-0 flex-col items-start gap-1">
        <span className="max-w-full truncate text-sm font-medium" title={name}>{name}</span>
        {shift ? <ShiftChip shift={shift} /> : (
          <span className="inline-flex h-6 items-center rounded-md border border-dashed px-2 text-xs text-muted-foreground">
            {emptyShift}
          </span>
        )}
      </div>
    </div>
  )
}

/** Yön göstergesi: karşılıklı takas ⇄ / vardiya devri → */
function Direction({ mutual }: { mutual: boolean }) {
  const Icon = mutual ? ArrowLeftRight : ArrowRight
  const label = mutual ? 'Karşılıklı takas' : 'Vardiya devri'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          tabIndex={0}
          className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:ml-0"
        >
          <Icon className="size-3.5 max-sm:rotate-90" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

type SwapView = Pick<ShiftSwapRequest, 'requester' | 'target' | 'requester_shift' | 'target_shift'>

function SwapParties({ swap, className }: { swap: SwapView; className?: string }) {
  return (
    // Dar ekranda taraflar alt alta, ok aşağı bakar
    <div className={cn('grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3', className)}>
      <Party name={swap.requester?.full_name ?? '—'} shift={swap.requester_shift} emptyShift="—" />
      <Direction mutual={!!swap.target_shift} />
      {swap.target
        ? <Party name={swap.target.full_name} shift={swap.target_shift} emptyShift="Karşılıksız devir" />
        : <span className="text-sm text-muted-foreground">—</span>}
    </div>
  )
}

function Notes({ swap }: { swap: ShiftSwapRequest }) {
  if (!swap.requester_note && !swap.reviewer_note) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-col gap-1 [overflow-wrap:anywhere]">
      {swap.requester_note && <p className="line-clamp-2 text-sm" title={swap.requester_note}>{swap.requester_note}</p>}
      {swap.reviewer_note && (
        <p className="line-clamp-2 text-xs text-muted-foreground" title={swap.reviewer_note}>
          <span className="font-medium">Yönetici:</span> {swap.reviewer_note}
        </p>
      )}
    </div>
  )
}

// ─── Yeni takas talebi ───────────────────────────────────────

function CreateSwapDialog({ open, onOpenChange, employees, assignments, currentEmployeeId, onCreate }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employees: EmployeeWithRole[]
  assignments: ShiftAssignmentWithDetails[]
  currentEmployeeId: string | null
  onCreate: (form: Partial<CreateSwapRequestPayload>) => Promise<string | null>
}) {
  const [form, setForm] = useState<Partial<CreateSwapRequestPayload>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = format(new Date(), 'yyyy-MM-dd')
  // Talep eden her zaman oturumdaki çalışandır; yalnızca bugün ve sonrasındaki vardiyalar takas edilebilir
  const myShifts = assignments.filter((a) => a.employee_id === currentEmployeeId && a.work_date >= today)
  const targetShifts = assignments.filter((a) => a.employee_id === form.target_id && a.work_date >= today)
  const me = employees.find((e) => e.id === currentEmployeeId)
  const target = employees.find((e) => e.id === form.target_id)
  const myShift = myShifts.find((a) => a.id === form.requester_shift_id)
  const targetShift = targetShifts.find((a) => a.id === form.target_shift_id)

  const close = () => { onOpenChange(false); setForm({}); setError(null) }

  const handleCreate = async () => {
    if (!form.requester_shift_id || !form.target_id) {
      setError('Vardiyanızı ve takas yapılacak çalışanı seçmelisiniz.')
      return
    }
    setSaving(true)
    setError(null)
    const err = await onCreate(form)
    setSaving(false)
    if (err) setError(err)
    else setForm({})
  }

  const shiftOption = (a: ShiftAssignmentWithDetails) => {
    const kind = kindOf(a.start_time, a.end_time)
    return (
      <span className="flex items-center gap-2">
        <span className="tabular-nums">{fmtDay(a.work_date)} · {hhmm(a.start_time)}–{hhmm(a.end_time)}</span>
        <span className="text-muted-foreground">{SHIFT_KIND_LABELS[kind]}</span>
      </span>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) close() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Takas talebi oluştur</DialogTitle>
          <DialogDescription>
            Teklifiniz önce seçtiğiniz çalışana, o kabul ederse yönetici onayına gider. Onaylanana kadar vardiyanız değişmez.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-5">
          <Field data-disabled={myShifts.length === 0 || undefined}>
            <FieldLabel htmlFor="swap-my-shift">Vardiyanız</FieldLabel>
            <Select value={form.requester_shift_id ?? ''} disabled={myShifts.length === 0}
              onValueChange={(v) => setForm((f) => ({ ...f, requester_shift_id: v }))}>
              <SelectTrigger id="swap-my-shift" className="w-full"><SelectValue placeholder="Vardiya seçin" /></SelectTrigger>
              <SelectContent>
                {myShifts.map((a) => <SelectItem key={a.id} value={a.id}>{shiftOption(a)}</SelectItem>)}
              </SelectContent>
            </Select>
            {myShifts.length === 0 && <FieldDescription>Bu hafta takas edilebilecek vardiyanız yok.</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor="swap-target">Takas yapılacak çalışan</FieldLabel>
            <Select value={form.target_id ?? ''}
              onValueChange={(id) => setForm((f) => ({ ...f, target_id: id, target_shift_id: undefined }))}>
              <SelectTrigger id="swap-target" className="w-full"><SelectValue placeholder="Çalışan seçin" /></SelectTrigger>
              <SelectContent>
                {employees.filter((e) => e.id !== currentEmployeeId).map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.target_id && targetShifts.length > 0 && (
            <Field>
              <FieldLabel htmlFor="swap-target-shift">Karşılığında alınacak vardiya</FieldLabel>
              <Select value={form.target_shift_id ?? NO_TARGET_SHIFT}
                onValueChange={(v) => setForm((f) => ({ ...f, target_shift_id: v === NO_TARGET_SHIFT ? null : v }))}>
                <SelectTrigger id="swap-target-shift" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TARGET_SHIFT}>Yok — vardiyamı devret</SelectItem>
                  {targetShifts.map((a) => <SelectItem key={a.id} value={a.id}>{shiftOption(a)}</SelectItem>)}
                </SelectContent>
              </Select>
              <FieldDescription>Boş bırakırsanız vardiyanız karşılıksız devredilir.</FieldDescription>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="swap-note">Not <span className="font-normal text-muted-foreground">(isteğe bağlı)</span></FieldLabel>
            <Textarea id="swap-note" rows={2} value={form.requester_note ?? ''} placeholder="Örn: Cuma akşamı ailevi bir programım var."
              onChange={(e) => setForm((f) => ({ ...f, requester_note: e.target.value }))} />
          </Field>

          {myShift && target && (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3">
              <p className="text-xs font-medium text-muted-foreground">Önizleme</p>
              <SwapParties
                swap={{
                  requester: { id: currentEmployeeId ?? '', full_name: me?.full_name ?? 'Siz' },
                  requester_shift: myShift,
                  target: { id: target.id, full_name: target.full_name },
                  target_shift: targetShift ?? null,
                }}
              />
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>Vazgeç</Button>
          <Button onClick={() => void handleCreate()} disabled={saving || !form.requester_shift_id || !form.target_id}>
            {saving && <Spinner />}
            Onaya gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Panel ───────────────────────────────────────────────────

export function ShiftSwapPanel({ employees, assignments, currentEmployeeId, isManager }: Props) {
  const confirm = useConfirm()
  const swapsQ = useSWR(SWAPS_KEY, fetchSwaps)
  const swaps = useMemo(() => swapsQ.data?.swap_requests ?? [], [swapsQ.data])
  const isFirstLoad = !swapsQ.data && !swapsQ.error
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reviewing, setReviewing] = useState<{ id: string; status: ReviewStatus } | null>(null)
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null)

  const visible = statusFilter === 'all' ? swaps : swaps.filter((s) => s.status === statusFilter)

  const handleCreate = async (form: Partial<CreateSwapRequestPayload>): Promise<string | null> => {
    try {
      const res = await fetch('/api/shift-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json() as { swap_request: ShiftSwapRequest; error?: string }
      if (!res.ok) return json.error ?? 'Hata.'
      setDialogOpen(false)
      toast.success('Takas talebi gönderildi')
      await swapsQ.mutate() // join'li (isimli) kaydı almak için
      return null
    } catch {
      return 'Kaydedilemedi.'
    }
  }

  const handleReview = async (swapId: string, status: ReviewStatus, reviewerNote?: string, acknowledge = false): Promise<void> => {
    setReviewing({ id: swapId, status })
    try {
      const res = await fetch('/api/shift-swap/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          swap_id: swapId, status, reviewer_note: reviewerNote || null, acknowledge_violations: acknowledge,
        }),
      })
      const json = await res.json() as { swap_request: ShiftSwapRequest; error?: string; code?: string; violations?: string[] }
      if (!res.ok) {
        // Çalışma süresi ihlali — yönetici açıkça onaylarsa tekrar gönderilir
        if (json.code === 'WORKING_TIME_VIOLATION') {
          setReviewing(null)
          if (await confirm({
            title: 'Çalışma süresi ihlali',
            message: 'Bu takas aşağıdaki İş Kanunu kurallarını ihlal ediyor.',
            items: json.violations ?? [],
            footer: 'Yine de onaylamak istiyor musunuz?',
            confirmText: 'İhlallere rağmen onayla',
            cancelText: 'Vazgeç',
          })) {
            return handleReview(swapId, 'approved', undefined, true)
          }
          return
        }
        toast.error(json.error ?? 'Hata.')
        return
      }
      // Yanıt join içermez — mevcut isim/vardiya bilgilerini koru
      await swapsQ.mutate(
        (d) => ({ swap_requests: (d?.swap_requests ?? []).map((s) => s.id === swapId ? { ...s, ...json.swap_request } : s) }),
        { revalidate: false }
      )
      toast.success(REVIEW_TOASTS[status])
    } catch {
      toast.error('İşlem başarısız.')
    } finally {
      setReviewing((r) => (r?.id === swapId ? null : r))
    }
  }

  // ── Satır eylemleri ──
  const actions = (swap: ShiftSwapRequest) => {
    const { canRespond, canReview, canCancel } = swapPermissions(swap, currentEmployeeId, isManager)
    if (!canRespond && !canReview && !canCancel) return null
    const busy = reviewing?.id === swap.id
    const spin = (s: ReviewStatus) => busy && reviewing?.status === s
    return (
      <div className="flex items-center justify-end gap-2">
        {canRespond && (
          <>
            <Button variant="outline" size="sm" onClick={() => void handleReview(swap.id, 'declined')} disabled={busy}>
              {spin('declined') ? <Spinner /> : <X />}
              Reddet
            </Button>
            <Button size="sm" onClick={() => void handleReview(swap.id, 'accepted')} disabled={busy}>
              {spin('accepted') ? <Spinner /> : <Check />}
              Kabul et
            </Button>
          </>
        )}
        {canReview && (
          <>
            <Button variant="outline" size="sm" onClick={() => setRejecting({ id: swap.id, note: '' })} disabled={busy}>
              {spin('rejected') ? <Spinner /> : <X />}
              Reddet
            </Button>
            <Button size="sm" onClick={() => void handleReview(swap.id, 'approved')} disabled={busy}>
              {spin('approved') ? <Spinner /> : <Check />}
              Onayla
            </Button>
          </>
        )}
        {canCancel && (
          <Button variant="ghost" size="sm" onClick={() => void handleReview(swap.id, 'cancelled')} disabled={busy}>
            {spin('cancelled') && <Spinner />}
            İptal et
          </Button>
        )}
      </div>
    )
  }

  const statusOf = (swap: ShiftSwapRequest) => {
    const { awaitingTarget } = swapPermissions(swap, currentEmployeeId, isManager)
    return STATUS_META[awaitingTarget ? 'awaiting_target' : swap.status] ?? { label: swap.status, tone: 'neutral' as BadgeTone }
  }

  const columns: ColumnDef<ShiftSwapRequest, unknown>[] = [
    {
      id: 'parties',
      header: () => (
        <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3">
          <span>Talep eden</span><span className="w-7" aria-hidden /><span>Karşı taraf</span>
        </span>
      ),
      enableSorting: false,
      meta: { className: 'w-[44%] min-w-[30rem] py-3', headerClassName: 'w-[44%]' },
      cell: ({ row }) => <SwapParties swap={row.original} />,
    },
    {
      id: 'note',
      header: 'Not',
      enableSorting: false,
      meta: { className: 'min-w-48 whitespace-normal' },
      cell: ({ row }) => <Notes swap={row.original} />,
    },
    {
      id: 'status',
      accessorFn: (s) => s.created_at,
      header: 'Durum',
      cell: ({ row }) => {
        const meta = statusOf(row.original)
        return (
          <span className="flex flex-col items-start gap-1">
            <StatusBadge tone={meta.tone} label={meta.label} />
            <span className="text-xs text-muted-foreground">{relativeDay(format(new Date(row.original.created_at), 'yyyy-MM-dd'))} oluşturuldu</span>
          </span>
        )
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'py-0' },
      cell: ({ row }) => actions(row.original),
    },
  ]

  const mobileItem = (swap: ShiftSwapRequest) => {
    const meta = statusOf(swap)
    const act = actions(swap)
    return (
      <Item variant="outline" size="sm" className="flex-col items-stretch gap-3">
        <ItemContent className="gap-3">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge tone={meta.tone} label={meta.label} />
            <span className="text-xs text-muted-foreground">{relativeDay(format(new Date(swap.created_at), 'yyyy-MM-dd'))}</span>
          </div>
          <SwapParties swap={swap} />
          {(swap.requester_note || swap.reviewer_note) && <Notes swap={swap} />}
        </ItemContent>
        {act && <ItemFooter className="justify-end">{act}</ItemFooter>}
      </Item>
    )
  }

  const toolbar = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
        <SelectTrigger className="sm:w-48" aria-label="Durum"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((k) => <SelectItem key={k} value={k}>{FILTER_LABELS[k]}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground sm:ml-auto">
        <Info className="size-4 shrink-0" />
        Takas, karşı taraf kabul edip yönetici onayladığında uygulanır.
      </p>
      <Button onClick={() => setDialogOpen(true)} disabled={!currentEmployeeId}>
        <Plus />
        Takas talebi oluştur
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      {swapsQ.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Takas talepleri yüklenemedi</AlertTitle>
          <AlertDescription>{swapsQ.error instanceof Error ? swapsQ.error.message : 'Bilinmeyen hata'}</AlertDescription>
        </Alert>
      )}

      {isFirstLoad ? (
        <div className="flex flex-col gap-3">
          {toolbar}
          <TableSkeleton rows={5} columns={4} />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={visible}
          toolbar={toolbar}
          getRowId={(s) => s.id}
          renderMobileItem={mobileItem}
          empty={
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon"><ArrowLeftRight /></EmptyMedia>
                <EmptyTitle>Takas talebi yok</EmptyTitle>
                <EmptyDescription>
                  {swaps.length > 0
                    ? 'Bu durumda takas talebi bulunamadı.'
                    : 'Vardiyanızı bir iş arkadaşınızla değiştirmek için takas talebi oluşturun.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
      )}

      <CreateSwapDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employees={employees}
        assignments={assignments}
        currentEmployeeId={currentEmployeeId}
        onCreate={handleCreate}
      />

      {/* Red gerekçesi */}
      <Dialog open={rejecting !== null} onOpenChange={(open) => { if (!open) setRejecting(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Takas talebini reddet</DialogTitle>
            <DialogDescription>Vardiyalar değişmez; talep reddedildi olarak kapanır.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="swap-reject-note">Gerekçe <span className="font-normal text-muted-foreground">(isteğe bağlı)</span></FieldLabel>
            <Textarea id="swap-reject-note" rows={3}
              value={rejecting?.note ?? ''}
              placeholder="Örn: Dinlenme süresi yetersiz kalıyor."
              onChange={(e) => setRejecting((r) => r && { ...r, note: e.target.value })} />
            <FieldDescription>Gerekçe talep kaydında görünür.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Vazgeç</Button>
            <Button variant="destructive"
              onClick={() => {
                if (!rejecting) return
                void handleReview(rejecting.id, 'rejected', rejecting.note.trim())
                setRejecting(null)
              }}>
              Reddet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
