'use client'

/**
 * LeavePage — Devam ve izin › İzinler
 *
 * Yönetici: "Onay bekleyenler / Tümü" sekmeleri + arama ve izin türü filtresiyle DataTable
 * (mobilde Item kartları), satırdan inceleme diyaloğu (onayla / reddet).
 * Çalışan: yalnızca kendi talepleri (Item listesi).
 * Herkes: yıllık izin bakiyesi kartı ve "İzin talebi" diyaloğu.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { differenceInCalendarDays, format } from 'date-fns'
import { tr } from 'date-fns/locale'
import {
  CalendarClock, CalendarRange, Check, Hourglass, Info, MoreHorizontal, Plane, Plus, Search, SquarePen, Trash2,
  TriangleAlert, X,
} from 'lucide-react'
import { toast } from 'sonner'

import type { EmployeeWithRole } from '@/types/employee'
import type {
  CreateLeaveRequestPayload, LeaveRequestWithEmployee, LeaveStatus, LeaveType,
} from '@/types/leave'
import { LEAVE_STATUS_LABELS, LEAVE_TYPE_LABELS } from '@/types/leave'
import { fetchActiveEmployees } from '@/lib/api/employees'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { apiFetch } from '@/lib/api/http'
import type { AnnualLeaveBalance } from '@/lib/annualLeave'
import { cn } from '@/lib/utils'
import {
  DataTable, DateField, EmployeeSelect, Page, PageHeader, PersonAvatar, StatCard, StatCards, StatusBadge, TableSkeleton,
  useConfirm,
  type BadgeTone, type ColumnDef,
} from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemTitle,
} from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// ─── Biçimlendirme ───────────────────────────────────────────

/** "Yıllık İzin" → "Yıllık izin" (cümle düzeni) */
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLocaleLowerCase('tr-TR')
const typeLabel = (t: LeaveType) => sentence(LEAVE_TYPE_LABELS[t] ?? t)
const statusLabel = (s: LeaveStatus) => sentence(LEAVE_STATUS_LABELS[s] ?? s)

function dayCount(start: string, end: string): number {
  return differenceInCalendarDays(new Date(end), new Date(start)) + 1
}

const day = (d: string) => new Date(`${d}T12:00:00`)
const fmt = (d: string, pattern: string) => {
  try { return format(day(d), pattern, { locale: tr }) } catch { return d }
}

/** "23–26 Kas 2026", "30 Eki – 2 Kas 2026", tek gün "25 Eki 2026" */
function fmtRange(start: string, end: string): string {
  if (start === end) return fmt(start, 'd MMM yyyy')
  if (start.slice(0, 7) === end.slice(0, 7)) return `${fmt(start, 'd')}–${fmt(end, 'd MMM yyyy')}`
  if (start.slice(0, 4) === end.slice(0, 4)) return `${fmt(start, 'd MMM')} – ${fmt(end, 'd MMM yyyy')}`
  return `${fmt(start, 'd MMM yyyy')} – ${fmt(end, 'd MMM yyyy')}`
}

const LEAVE_STATUS_TONES: Record<LeaveStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
}

function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return <StatusBadge tone={LEAVE_STATUS_TONES[status] ?? 'neutral'} label={statusLabel(status)} />
}

const REQUESTABLE_TYPES: LeaveType[] = ['annual', 'sick', 'personal', 'unpaid', 'other']
const FILTER_TYPES: LeaveType[] = [...REQUESTABLE_TYPES, 'weekly_rest']
const todayIso = () => format(new Date(), 'yyyy-MM-dd')
const normalize = (s: string) => s.toLocaleLowerCase('tr-TR')

// ─── Yıllık izin bakiyesi ────────────────────────────────────

function BalanceCard({ balance }: { balance: AnnualLeaveBalance }) {
  if (!balance.known) {
    return (
      <Alert tone="info">
        <Info />
        <AlertTitle>Yıllık izin bakiyesi hesaplanamadı</AlertTitle>
        <AlertDescription>İşe giriş tarihiniz kayıtlı değil. Yöneticinizden eklemesini isteyin.</AlertDescription>
      </Alert>
    )
  }
  const remaining = Math.max(0, balance.remainingDays)
  const total = Math.max(1, balance.entitlementDays)
  const usedPct = Math.min(100, (balance.usedDays / total) * 100)
  const pendingPct = Math.min(100 - usedPct, (balance.pendingDays / total) * 100)
  const low = balance.remainingDays <= 2

  return (
    <Card className="@container/card gap-4 bg-linear-to-t from-primary/5 to-card shadow-xs">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5"><Plane className="size-4" />Yıllık izin bakiyem</CardDescription>
        <CardTitle className="text-3xl font-semibold tabular-nums">{remaining} gün</CardTitle>
        <CardDescription>{balance.entitlementDays} günlük hakkınızdan kalan</CardDescription>
        <CardAction>
          {low
            ? <Badge tone="warning">Az kaldı</Badge>
            : <Badge variant="outline" className="tabular-nums">{balance.seniorityYears}. yıl</Badge>}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          role="img"
          aria-label={`${balance.usedDays} gün kullanıldı, ${balance.pendingDays} gün onay bekliyor, ${remaining} gün kaldı`}
          className="flex h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-foreground/70" style={{ width: `${usedPct}%` }} />
          <div className="h-full bg-warning" style={{ width: `${pendingPct}%` }} />
        </div>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {[
            { label: 'Hak', value: balance.entitlementDays, dot: 'bg-muted-foreground/30' },
            { label: 'Kullanılan', value: balance.usedDays, dot: 'bg-foreground/70' },
            { label: 'Bekleyen', value: balance.pendingDays, dot: 'bg-warning' },
          ].map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <span aria-hidden className={cn('size-2 rounded-full', s.dot)} />
                {s.label}
              </dt>
              <dd className="font-medium tabular-nums">{s.value} gün</dd>
            </div>
          ))}
        </dl>
      </CardContent>
      <CardFooter className="border-t text-xs text-muted-foreground [.border-t]:pt-4">
        Dönem {balance.periodStart && fmt(balance.periodStart, 'd MMM yyyy')} – {balance.periodEnd && fmt(balance.periodEnd, 'd MMM yyyy')}.
        Pazar ve resmi tatiller izinden sayılmaz.
      </CardFooter>
    </Card>
  )
}

// ─── Yeni talep diyaloğu ─────────────────────────────────────

function NewRequestDialog({ open, onClose, onSave, employees, isManager, meId, myBalance, saving }: {
  open: boolean
  onClose: () => void
  onSave: (payload: CreateLeaveRequestPayload) => Promise<void>
  employees: EmployeeWithRole[]
  isManager: boolean
  meId: string | undefined
  myBalance: AnnualLeaveBalance | undefined
  saving: boolean
}) {
  // Diyalog her açılışta yeni `key` ile mount edilir → state ilk değerlerden başlar
  const [employeeId, setEmployeeId] = useState(employees.length === 1 ? employees[0].id : '')
  const [leaveType, setLeaveType] = useState<LeaveType>('annual')
  const [startDate, setStartDate] = useState(todayIso)
  const [endDate, setEndDate] = useState(todayIso)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rangeOk = !!startDate && !!endDate && startDate <= endDate
  const days = rangeOk ? dayCount(startDate, endDate) : 0
  const showBalance = leaveType === 'annual' && myBalance?.known && employeeId === meId

  const handleSave = async () => {
    setError(null)
    if (!employeeId) { setError('Çalışan seçin.'); return }
    if (!rangeOk) { setError('Başlangıç tarihi bitiş tarihinden sonra olamaz.'); return }
    try {
      await onSave({ employee_id: employeeId, leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason || null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Talep oluşturulamadı.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>İzin talebi</DialogTitle>
          <DialogDescription>Tarih aralığını ve izin türünü seçin; talep yönetici onayına gider.</DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-5">
          {isManager && (
            <EmployeeSelect
              employees={employees}
              value={employeeId}
              label="Çalışan"
              onChange={setEmployeeId}
              showRole
              fullWidth
            />
          )}

          <Field>
            <FieldLabel htmlFor="leave-type">İzin türü</FieldLabel>
            <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
              <SelectTrigger id="leave-type" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REQUESTABLE_TYPES.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
              </SelectContent>
            </Select>
            {showBalance && (
              <FieldDescription>Kalan yıllık izniniz: {Math.max(0, myBalance!.remainingDays)} gün</FieldDescription>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <DateField fullWidth label="Başlangıç" value={startDate} onChange={setStartDate} />
            <DateField fullWidth label="Bitiş" value={endDate} min={startDate || undefined} onChange={setEndDate} />
          </div>

          <Field>
            <FieldLabel htmlFor="leave-reason">Açıklama</FieldLabel>
            <Textarea
              id="leave-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="İzin sebebini kısaca yazabilirsiniz"
            />
            <FieldDescription>İsteğe bağlı; yöneticiniz talepte görür.</FieldDescription>
          </Field>

          {error ? (
            <FieldError>{error}</FieldError>
          ) : days > 0 && (
            <p className="text-sm text-muted-foreground">
              Toplam <span className="font-medium text-foreground tabular-nums">{days} gün</span>
              {leaveType === 'annual' && ' · Pazar ve resmi tatiller yıllık izinden düşülmez'}
            </p>
          )}
        </FieldGroup>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>İptal</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving && <Spinner />}
            Talebi gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── İnceleme diyaloğu ───────────────────────────────────────

function ReviewDialog({ request, onClose, onReview }: {
  request: LeaveRequestWithEmployee | null
  onClose: () => void
  onReview: (requestId: string, status: 'approved' | 'rejected', note: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<'approved' | 'rejected' | null>(null)

  const handle = async (status: 'approved' | 'rejected') => {
    if (!request) return
    setError(null)
    setSaving(status)
    try {
      await onReview(request.id, status, note)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem başarısız.')
    } finally {
      setSaving(null)
    }
  }

  const emp = request?.employees
  return (
    <Dialog open={!!request} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>İzin talebini incele</DialogTitle>
          <DialogDescription>Talebi onaylayın ya da gerekçesiyle reddedin.</DialogDescription>
        </DialogHeader>

        {request && (
          <div className="overflow-hidden rounded-lg border">
            <Item size="sm" className="rounded-none">
              <ItemMedia><PersonAvatar name={emp?.full_name ?? '?'} size={36} /></ItemMedia>
              <ItemContent>
                <ItemTitle>{emp?.full_name ?? '—'}</ItemTitle>
                {emp?.roles?.name && <ItemDescription>{emp.roles.name}</ItemDescription>}
              </ItemContent>
              <ItemActions><LeaveStatusBadge status={request.status} /></ItemActions>
            </Item>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t bg-muted/40 px-4 py-3 text-sm">
              <div>
                <dt className="text-muted-foreground">İzin türü</dt>
                <dd className="font-medium">{typeLabel(request.leave_type)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Süre</dt>
                <dd className="font-medium tabular-nums">{dayCount(request.start_date, request.end_date)} gün</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Tarih</dt>
                <dd className="font-medium tabular-nums">
                  {fmt(request.start_date, 'd MMMM yyyy EEEE')}
                  {request.end_date !== request.start_date && ` – ${fmt(request.end_date, 'd MMMM yyyy EEEE')}`}
                </dd>
              </div>
              {request.reason && (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Açıklama</dt>
                  <dd className="[overflow-wrap:anywhere]">{request.reason}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="leave-review-note">Yönetici notu</FieldLabel>
          <Textarea
            id="leave-review-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Onay veya red sebebini yazabilirsiniz"
          />
          {error ? <FieldError>{error}</FieldError> : <FieldDescription>İsteğe bağlı; çalışan talebinde görür.</FieldDescription>}
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={!!saving} className="sm:mr-auto">İptal</Button>
          <Button
            variant="outline"
            onClick={() => void handle('rejected')}
            disabled={!!saving}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {saving === 'rejected' ? <Spinner /> : <X />}
            Reddet
          </Button>
          <Button onClick={() => void handle('approved')} disabled={!!saving}>
            {saving === 'approved' ? <Spinner /> : <Check />}
            Onayla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Satır eylemleri ─────────────────────────────────────────

function RowActions({ request, onReview, onDelete }: {
  request: LeaveRequestWithEmployee
  onReview?: () => void
  onDelete?: () => void
}) {
  if (!onReview && !onDelete) return null
  const name = request.employees?.full_name ?? 'Talep'
  return (
    <div className="flex items-center justify-end gap-1">
      {onReview && <Button variant="outline" size="sm" onClick={onReview}>İncele</Button>}
      {onDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground data-[state=open]:bg-muted" aria-label={`${name} talebi işlemleri`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {onReview && (
              <>
                <DropdownMenuItem onClick={onReview}><SquarePen />İncele</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 />Talebi sil</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// ─── Sayfa ───────────────────────────────────────────────────

type TabValue = 'pending' | 'all'

export function LeavePage() {
  const { employee: me } = useAuth()
  const isManager = hasRole(me?.roles?.access_level ?? null, MANAGER_ROLES)
  const confirm = useConfirm()

  const requestsQ = useSWR('/api/leave', (url: string) => apiFetch<{ requests: LeaveRequestWithEmployee[] }>(url))
  // Çalışan seçimi yalnızca yöneticiler için; çalışan kendi adına talep açar
  const employeesQ = useSWR(isManager ? 'employees:active' : null, fetchActiveEmployees)
  const employees: EmployeeWithRole[] = isManager
    ? employeesQ.data ?? []
    : me ? [{ ...(me as unknown as EmployeeWithRole) }] : []
  // Çalışan, başkalarının (takvimde görünen) onaylı izinlerini burada görmez — yalnızca kendi talepleri
  const requests = useMemo(
    () => (requestsQ.data?.requests ?? []).filter((r) => isManager || r.employee_id === me?.id),
    [requestsQ.data, isManager, me?.id]
  )
  const isFirstLoad = !requestsQ.data && !requestsQ.error
  const loadError = requestsQ.error ? (requestsQ.error instanceof Error ? requestsQ.error.message : 'Yükleme hatası.') : null

  const [tab, setTab] = useState<TabValue>('pending')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | LeaveType>('all')

  const [newOpen, setNewOpen] = useState(false)
  const [newSaving, setNewSaving] = useState(false)
  const [reviewTarget, setReviewTarget] = useState<LeaveRequestWithEmployee | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LeaveRequestWithEmployee | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = () => requestsQ.mutate()
  // Oturumdaki çalışanın yıllık izin bakiyesi (İş K. Md. 53)
  const balanceQ = useSWR(me ? '/api/leave/balance' : null, (url: string) => apiFetch<{ balance: AnnualLeaveBalance }>(url))
  const balance = balanceQ.data?.balance

  const handleNewSave = async (payload: CreateLeaveRequestPayload) => {
    setNewSaving(true)
    try {
      const res = await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json() as { error?: string; code?: string }
      if (!res.ok) {
        // Yönetici, bakiyeyi aşan yıllık izni (avans izin) açıkça onaylayarak kaydedebilir
        if (data.code === 'ANNUAL_LEAVE_EXCEEDED' && isManager && payload.employee_id !== me?.id &&
            await confirm({
              title: 'Yıllık izin bakiyesi aşılıyor',
              message: data.error,
              footer: 'Avans izin olarak yine de oluşturulsun mu?',
              confirmText: 'Avans izin oluştur',
            })) {
          return handleNewSave({ ...payload, allow_exceed: true } as CreateLeaveRequestPayload)
        }
        throw new Error(data.error ?? 'Talep oluşturulamadı.')
      }
      setNewOpen(false)
      toast.success('İzin talebi oluşturuldu')
      await Promise.all([load(), balanceQ.mutate()])
    } finally {
      setNewSaving(false)
    }
  }

  const handleReview = async (requestId: string, status: 'approved' | 'rejected', note: string) => {
    const res = await fetch('/api/leave/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, status, reviewer_note: note || null }),
    })
    const data = await res.json() as { error?: string }
    if (!res.ok) throw new Error(data.error ?? 'İşlem başarısız.')
    const name = reviewTarget?.employees?.full_name
    setReviewTarget(null)
    toast.success(`${name ? `${name} adlı çalışanın talebi` : 'Talep'} ${status === 'approved' ? 'onaylandı' : 'reddedildi'}`)
    await load()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/leave?id=${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Silme işlemi başarısız.')
      setDeleteTarget(null)
      toast.success('İzin talebi silindi')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Silme hatası.')
    } finally {
      setDeleting(false)
    }
  }

  const canReview = (r: LeaveRequestWithEmployee) => isManager && r.status === 'pending' && r.employee_id !== me?.id
  const canDelete = (r: LeaveRequestWithEmployee) => isManager || (r.employee_id === me?.id && r.status === 'pending')
  const actionsFor = (r: LeaveRequestWithEmployee) => ({
    onReview: canReview(r) ? () => setReviewTarget(r) : undefined,
    onDelete: canDelete(r) ? () => setDeleteTarget(r) : undefined,
  })

  const pending = requests.filter((r) => r.status === 'pending')
  const pendingDays = pending.reduce((n, r) => n + dayCount(r.start_date, r.end_date), 0)
  const today = todayIso()
  const realApproved = requests.filter((r) => r.status === 'approved' && r.leave_type !== 'weekly_rest')
  const onLeaveToday = realApproved.filter((r) => r.start_date <= today && r.end_date >= today)
  const upcoming = realApproved
    .filter((r) => r.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return requests.filter((r) =>
      (typeFilter === 'all' || r.leave_type === typeFilter) &&
      (!q || normalize(r.employees?.full_name ?? '').includes(q)))
  }, [requests, query, typeFilter])
  const filteredPending = filtered.filter((r) => r.status === 'pending')

  // ── Yönetici tablosu ──
  const columns: ColumnDef<LeaveRequestWithEmployee, unknown>[] = [
    {
      id: 'employee',
      accessorFn: (r) => r.employees?.full_name ?? '',
      header: 'Çalışan',
      sortingFn: (a, b) => (a.original.employees?.full_name ?? '').localeCompare(b.original.employees?.full_name ?? '', 'tr'),
      cell: ({ row }) => {
        const emp = row.original.employees
        return (
          <span className="flex items-center gap-2.5">
            <PersonAvatar name={emp?.full_name ?? '?'} size={28} />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{emp?.full_name ?? '—'}</span>
              {emp?.roles?.name && <span className="text-xs text-muted-foreground">{emp.roles.name}</span>}
            </span>
          </span>
        )
      },
    },
    {
      id: 'type',
      accessorKey: 'leave_type',
      header: 'İzin türü',
      cell: ({ row }) => typeLabel(row.original.leave_type),
    },
    {
      id: 'date',
      accessorKey: 'start_date',
      header: 'Tarih',
      meta: { className: 'whitespace-nowrap tabular-nums' },
      cell: ({ row }) => fmtRange(row.original.start_date, row.original.end_date),
    },
    {
      id: 'days',
      accessorFn: (r) => dayCount(r.start_date, r.end_date),
      header: 'Süre',
      meta: { align: 'right', className: 'tabular-nums' },
      cell: ({ getValue }) => `${getValue<number>()} gün`,
    },
    {
      id: 'reason',
      header: 'Açıklama',
      enableSorting: false,
      meta: { className: 'max-w-72' },
      cell: ({ row }) => {
        const r = row.original
        if (!r.reason && !r.reviewer_note) return <span className="text-muted-foreground">—</span>
        return (
          <span className="flex min-w-0 flex-col">
            {r.reason && <span className="truncate text-muted-foreground" title={r.reason}>{r.reason}</span>}
            {r.reviewer_note && (
              <span className="truncate text-xs text-muted-foreground" title={r.reviewer_note}>Yönetici: {r.reviewer_note}</span>
            )}
          </span>
        )
      },
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Durum',
      cell: ({ row }) => <LeaveStatusBadge status={row.original.status} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">İşlemler</span>,
      enableSorting: false,
      meta: { align: 'right', className: 'w-32 py-0' },
      cell: ({ row }) => <RowActions request={row.original} {...actionsFor(row.original)} />,
    },
  ]

  /** Yönetici mobil kartı ve çalışan listesi satırı */
  const requestItem = (r: LeaveRequestWithEmployee, opts: { showPerson: boolean; outline?: boolean }) => {
    const emp = r.employees
    const days = dayCount(r.start_date, r.end_date)
    const actions = actionsFor(r)
    return (
      <Item variant={opts.outline ? 'outline' : 'default'} size="sm" className={cn('items-start', !opts.outline && 'rounded-none px-4 md:px-6')}>
        <ItemMedia variant={opts.showPerson ? 'default' : 'icon'}>
          {opts.showPerson ? <PersonAvatar name={emp?.full_name ?? '?'} size={32} /> : <Plane />}
        </ItemMedia>
        <ItemContent className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <ItemTitle>{opts.showPerson ? emp?.full_name ?? '—' : typeLabel(r.leave_type)}</ItemTitle>
            <span className={cn('-my-0.5', !opts.outline && 'sm:hidden')}><LeaveStatusBadge status={r.status} /></span>
          </div>
          <ItemDescription className="text-pretty tabular-nums">
            {opts.showPerson && `${typeLabel(r.leave_type)} · `}{fmtRange(r.start_date, r.end_date)} · {days} gün
          </ItemDescription>
          {r.reason && <ItemDescription className="line-clamp-1 text-pretty [overflow-wrap:anywhere]">{r.reason}</ItemDescription>}
          {r.reviewer_note && (
            <ItemDescription className="line-clamp-2 text-xs text-pretty [overflow-wrap:anywhere]">Yönetici notu: {r.reviewer_note}</ItemDescription>
          )}
        </ItemContent>
        {(!opts.outline || actions.onDelete) && (
          <ItemActions className="gap-1">
            {!opts.outline && <span className="max-sm:hidden"><LeaveStatusBadge status={r.status} /></span>}
            {opts.outline
              ? <RowActions request={r} onDelete={actions.onDelete} />
              : <RowActions request={r} {...actions} />}
          </ItemActions>
        )}
        {opts.outline && actions.onReview && (
          <ItemFooter>
            <Button variant="outline" size="sm" className="w-full" onClick={actions.onReview}>
              <SquarePen />
              İncele
            </Button>
          </ItemFooter>
        )}
      </Item>
    )
  }

  const emptyState = (title: string, description: string, withAction = false) => (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Plane /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {withAction && (
        <EmptyContent>
          <Button variant="outline" onClick={() => setNewOpen(true)}><Plus />Yeni izin talebi</Button>
        </EmptyContent>
      )}
    </Empty>
  )
  const filtersActive = !!query.trim() || typeFilter !== 'all'
  const noMatch = emptyState('Sonuç yok', 'Aramaya veya izin türüne uyan talep bulunamadı.')

  const toolbar = (
    <div className="flex items-center gap-2">
      <InputGroup className="min-w-0 flex-1 sm:w-56 sm:flex-none">
        <InputGroupInput placeholder="Çalışan ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Çalışan ara" />
        <InputGroupAddon><Search /></InputGroupAddon>
      </InputGroup>
      <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'all' | LeaveType)}>
        <SelectTrigger className="w-40 sm:w-44" aria-label="İzin türü"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tüm izin türleri</SelectItem>
          {FILTER_TYPES.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )

  const managerList = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
      <div className="flex flex-col gap-3 @3xl/main:flex-row @3xl/main:items-center @3xl/main:justify-between">
        <TabsList>
          <TabsTrigger value="pending">
            Onay bekleyenler <Badge variant="secondary" className="tabular-nums">{pending.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="all">
            Tümü <Badge variant="secondary" className="tabular-nums">{requests.length}</Badge>
          </TabsTrigger>
        </TabsList>
        {toolbar}
      </div>
      <TabsContent value="pending" className="mt-1">
        <DataTable
          columns={columns}
          data={filteredPending}
          initialSorting={[{ id: 'date', desc: false }]}
          getRowId={(r) => r.id}
          renderMobileItem={(r) => requestItem(r, { showPerson: true, outline: true })}
          empty={filtersActive && pending.length > 0 ? noMatch : emptyState('Onay bekleyen talep yok', 'Yeni izin talepleri geldiğinde burada listelenir.')}
        />
      </TabsContent>
      <TabsContent value="all" className="mt-1">
        <DataTable
          columns={columns}
          data={filtered}
          initialSorting={[{ id: 'date', desc: true }]}
          getRowId={(r) => r.id}
          renderMobileItem={(r) => requestItem(r, { showPerson: true, outline: true })}
          empty={filtersActive && requests.length > 0 ? noMatch : emptyState('Henüz izin talebi yok', 'Oluşturulan talepler burada listelenir.')}
        />
      </TabsContent>
    </Tabs>
  )

  const sortedMine = [...requests].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const employeeList = (
    <Card className="gap-0 overflow-hidden py-0 shadow-xs">
      <CardHeader className="border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-2">
          Taleplerim <Badge variant="secondary" className="tabular-nums">{requests.length}</Badge>
        </CardTitle>
        <CardDescription>
          {pending.length > 0 ? `${pending.length} talep onay bekliyor` : 'Onay bekleyen talebiniz yok'}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {sortedMine.length === 0
          ? emptyState('Henüz izin talebiniz yok', 'Yeni bir talep oluşturduğunuzda durumunu buradan takip edebilirsiniz.', true)
          : (
            <ItemGroup className="divide-y">
              {sortedMine.map((r) => <div key={r.id} role="listitem">{requestItem(r, { showPerson: false })}</div>)}
            </ItemGroup>
          )}
      </CardContent>
    </Card>
  )

  return (
    <Page>
      <PageHeader
        title="İzinler"
        description={
          isFirstLoad
            ? <Skeleton className="h-4 w-40" />
            : isManager
              ? pending.length > 0 ? `${pending.length} talep onay bekliyor` : 'Onay bekleyen talep yok'
              : 'İzin talepleriniz ve yıllık izin bakiyeniz'
        }
        actions={
          <Button onClick={() => setNewOpen(true)} className="max-sm:w-full">
            <Plus />
            Yeni izin talebi
          </Button>
        }
      />

      {loadError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>İzin talepleri yüklenemedi</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {isManager ? (
        <>
          {isFirstLoad ? (
            <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)}
            </div>
          ) : (
            <StatCards>
              <StatCard
                icon={<Hourglass />}
                label="Onay bekleyen"
                value={pending.length}
                valueClassName={pending.length > 0 ? 'text-warning' : undefined}
                hint={pending.length > 0 ? `Toplam ${pendingDays} gün izin` : 'Bekleyen talep yok'}
              />
              <StatCard
                icon={<Plane />}
                label="Bugün izinli"
                value={onLeaveToday.length}
                hint={onLeaveToday.length > 0
                  ? onLeaveToday.map((r) => r.employees?.full_name?.split(' ')[0]).filter(Boolean).join(', ')
                  : 'Bugün izinli çalışan yok'}
              />
              <StatCard
                icon={<CalendarRange />}
                label="Yaklaşan izin"
                value={upcoming.length}
                hint={upcoming[0] ? `İlki ${fmt(upcoming[0].start_date, 'd MMM')} · ${upcoming[0].employees?.full_name ?? ''}` : 'Onaylı yaklaşan izin yok'}
              />
              <StatCard
                icon={<CalendarClock />}
                label="Yıllık izin bakiyem"
                value={balance?.known ? `${Math.max(0, balance.remainingDays)} gün` : '—'}
                hint={balance?.known
                  ? `${balance.entitlementDays} gün hak · ${balance.usedDays} kullanıldı`
                  : balance ? 'İşe giriş tarihi kayıtlı değil' : 'Hesaplanıyor…'}
              />
            </StatCards>
          )}
          {isFirstLoad ? <TableSkeleton rows={6} columns={6} /> : managerList}
        </>
      ) : (
        <div className="grid items-start gap-4 md:gap-6 @5xl/main:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            {isFirstLoad ? <TableSkeleton rows={4} columns={3} /> : employeeList}
          </div>
          <aside className="order-first flex flex-col gap-4 @5xl/main:order-none" aria-label="Yıllık izin bakiyesi">
            {balance ? <BalanceCard balance={balance} /> : !balanceQ.error && me && <Skeleton className="h-[220px] rounded-xl" />}
          </aside>
        </div>
      )}

      <NewRequestDialog
        key={newOpen ? 'open' : 'closed'}
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSave={handleNewSave}
        employees={employees}
        isManager={isManager}
        meId={me?.id}
        myBalance={balance}
        saving={newSaving}
      />
      <ReviewDialog
        key={reviewTarget?.id ?? 'none'}
        request={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onReview={handleReview}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => { if (!next && !deleting) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>İzin talebi silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  <span className="font-medium text-foreground">{deleteTarget.employees?.full_name}</span> adlı çalışanın{' '}
                  <span className="font-medium text-foreground tabular-nums">{fmtRange(deleteTarget.start_date, deleteTarget.end_date)}</span>{' '}
                  tarihli {typeLabel(deleteTarget.leave_type).toLocaleLowerCase('tr-TR')} talebi silinecek.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget?.status === 'approved' && (
            <Alert tone="warning">
              <TriangleAlert />
              <AlertDescription>
                Bu izin onaylıydı. Silme işlemi bu tarihlerdeki &ldquo;İzinli&rdquo; işaretlemelerini de kaldırır.
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Vazgeç</Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? <Spinner /> : <Trash2 />}
              Sil
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  )
}
