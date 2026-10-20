'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { EmployeeWithRole } from '@/types/employee'
import {
  DateField, EmployeeSelect, PageHeader, ListSkeleton, useConfirm, PersonAvatar, SectionCard, SectionRow,
  StatCard, StatGrid, StatusBadge, type BadgeTone,
} from '@/components/common'
import type {
  LeaveRequestWithEmployee,
  LeaveType,
  LeaveStatus,
  CreateLeaveRequestPayload,
} from '@/types/leave'
import {
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
} from '@/types/leave'
import { fetchActiveEmployees } from '@/lib/api/employees'
import { format, differenceInCalendarDays } from 'date-fns'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { apiFetch } from '@/lib/api/http'
import type { AnnualLeaveBalance } from '@/lib/annualLeave'
import { C } from '@/lib/palette'
import { AlertCircle, Check, CircleCheck, Info, Loader2, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// ─── Helpers ─────────────────────────────────────────────────

function dayCount(start: string, end: string): number {
  return differenceInCalendarDays(new Date(end), new Date(start)) + 1
}

function fmtDate(d: string): string {
  try {
    return format(new Date(d + 'T00:00:00'), 'dd.MM.yyyy')
  } catch {
    return d
  }
}

// ─── New Request Dialog ──────────────────────────────────────

interface NewRequestDialogProps {
  open: boolean
  onClose: () => void
  onSave: (payload: CreateLeaveRequestPayload) => Promise<void>
  employees: EmployeeWithRole[]
  saving: boolean
}

const LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'personal', 'unpaid', 'other']
const today = format(new Date(), 'yyyy-MM-dd')

function NewRequestDialog({ open, onClose, onSave, employees, saving }: NewRequestDialogProps) {
  // Dialog her açılışta yeni `key` ile mount edilir → state ilk değerlerden başlar
  const [employeeId, setEmployeeId] = useState(employees.length === 1 ? employees[0].id : '')
  const [leaveType, setLeaveType] = useState<LeaveType>('annual')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const days = dayCount(startDate, endDate)

  const handleSave = async () => {
    setError(null)
    if (!employeeId) { setError('Çalışan seçiniz.'); return }
    if (startDate > endDate) { setError('Başlangıç tarihi bitiş tarihinden sonra olamaz.'); return }
    try {
      await onSave({ employee_id: employeeId, leave_type: leaveType, start_date: startDate, end_date: endDate, reason: reason || null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hata oluştu.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni İzin Talebi</DialogTitle>
          <DialogDescription>Tarih aralığını ve izin tipini seçin; talep yönetici onayına gider.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {error && (
            <Alert tone="danger" className="sm:col-span-2">
              <AlertCircle />
              <AlertDescription className="text-ink">{error}</AlertDescription>
            </Alert>
          )}

          <EmployeeSelect
            employees={employees}
            value={employeeId}
            label="Çalışan *"
            onChange={setEmployeeId}
            showRole
            fullWidth
            className="sm:col-span-2"
          />

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="leave-type">İzin tipi *</Label>
            <Select value={leaveType} onValueChange={(v) => setLeaveType(v as LeaveType)}>
              <SelectTrigger id="leave-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DateField
            fullWidth
            size="small"
            label="Başlangıç *"
            value={startDate}
            onChange={setStartDate}
          />
          <DateField
            fullWidth
            size="small"
            label="Bitiş *"
            value={endDate}
            min={startDate || undefined}
            onChange={setEndDate}
          />

          {days > 0 && startDate <= endDate && (
            <p className="text-xs font-semibold text-primary sm:col-span-2">Toplam: {days} gün</p>
          )}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="leave-reason">Açıklama (opsiyonel)</Label>
            <Textarea
              id="leave-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="İzin sebebini açıklayabilirsiniz..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>İptal</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Talebi Gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Review Dialog ────────────────────────────────────────────

interface ReviewDialogProps {
  open: boolean
  request: LeaveRequestWithEmployee | null
  onClose: () => void
  onReview: (requestId: string, status: 'approved' | 'rejected', note: string) => Promise<void>
  saving: boolean
}

function ReviewDialog({ open, request, onClose, onReview, saving }: ReviewDialogProps) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handle = async (status: 'approved' | 'rejected') => {
    setError(null)
    try {
      await onReview(request!.id, status, note)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hata oluştu.')
    }
  }

  if (!request) return null
  const emp = request.employees
  const days = dayCount(request.start_date, request.end_date)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>İzin Talebini İncele</DialogTitle>
          <DialogDescription>Talebi onaylayın ya da gerekçesiyle reddedin.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error && (
            <Alert tone="danger">
              <AlertCircle />
              <AlertDescription className="text-ink">{error}</AlertDescription>
            </Alert>
          )}

          <div className="rounded-xl bg-surface-muted px-4 py-3">
            <p className="text-sm font-bold text-ink">{emp?.full_name ?? '—'}</p>
            {emp?.roles?.name && <p className="text-xs text-ink-secondary">{emp.roles.name}</p>}
            <dl className="mt-2.5 grid gap-1.5 border-t pt-2.5">
              <Row label="İzin tipi" value={LEAVE_TYPE_LABELS[request.leave_type]} />
              <Row label="Tarih" value={`${fmtDate(request.start_date)} – ${fmtDate(request.end_date)} (${days} gün)`} />
              {request.reason && <Row label="Açıklama" value={request.reason} />}
            </dl>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="leave-review-note">Yönetici notu (opsiyonel)</Label>
            <Textarea
              id="leave-review-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Onay veya red sebebini belirtebilirsiniz..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>İptal</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => handle('rejected')}
            disabled={saving}
            className="text-danger hover:bg-danger-soft hover:text-danger"
          >
            <X />
            Reddet
          </Button>
          <Button type="button" onClick={() => handle('approved')} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Onayla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <dt className="min-w-20 text-ink-secondary">{label}</dt>
      <dd className="font-semibold text-ink [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

// ─── Leave Status Chip ────────────────────────────────────────

const LEAVE_STATUS_TONES: Record<LeaveStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
}

function LeaveStatusChip({ status }: { status: LeaveStatus }) {
  return <StatusBadge tone={LEAVE_STATUS_TONES[status]} label={LEAVE_STATUS_LABELS[status]} />
}

// ─── Yıllık izin bakiyesi ─────────────────────────────────────

function AnnualLeaveCard({ balance }: { balance: AnnualLeaveBalance }) {
  if (!balance.known) {
    return (
      <Alert tone="info" className="mb-4">
        <Info />
        <AlertDescription className="text-ink">
          Yıllık izin bakiyeniz hesaplanamadı: işe giriş tarihiniz kayıtlı değil. Yöneticinizden eklemesini isteyin.
        </AlertDescription>
      </Alert>
    )
  }
  const low = balance.remainingDays <= 2
  return (
    <div className="mb-4">
      <StatGrid min={140} className="mb-2 md:mb-2">
        <StatCard label={`Yıllık hak (${balance.seniorityYears}. yıl)`} value={`${balance.entitlementDays} gün`} />
        <StatCard label="Kullanılan" value={`${balance.usedDays} gün`} />
        <StatCard label="Onay bekleyen" value={`${balance.pendingDays} gün`} valueColor={balance.pendingDays ? C.warning : undefined} />
        <StatCard label="Kalan" value={`${Math.max(0, balance.remainingDays)} gün`} valueColor={low ? C.warning : C.success} />
      </StatGrid>
      <p className="text-xs text-ink-secondary">
        Dönem: {balance.periodStart && fmtDate(balance.periodStart)} – {balance.periodEnd && fmtDate(balance.periodEnd)} · Pazar ve resmi tatiller izinden sayılmaz
      </p>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────

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
  const requests = (requestsQ.data?.requests ?? []).filter((r) => isManager || r.employee_id === me?.id)
  const isFirstLoad = !requestsQ.data && !requestsQ.error
  const [actionError, setError] = useState<string | null>(null)
  const loadError = requestsQ.error ? (requestsQ.error instanceof Error ? requestsQ.error.message : 'Yükleme hatası.') : null
  const error = actionError ?? loadError
  const [success, setSuccess] = useState<string | null>(null)

  // Tab: 0=pending 1=all
  const [tab, setTab] = useState(0)

  // New request dialog
  const [newOpen, setNewOpen] = useState(false)
  const [newSaving, setNewSaving] = useState(false)

  // Review dialog
  const [reviewTarget, setReviewTarget] = useState<LeaveRequestWithEmployee | null>(null)
  const [reviewSaving, setReviewSaving] = useState(false)

  // Delete confirm state
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
              title: 'Yıllık İzin Bakiyesi Aşılıyor',
              message: data.error,
              footer: 'Avans izin olarak yine de oluşturulsun mu?',
              confirmText: 'Avans İzin Oluştur',
            })) {
          return handleNewSave({ ...payload, allow_exceed: true } as CreateLeaveRequestPayload)
        }
        throw new Error(data.error ?? 'Talep oluşturulamadı.')
      }
      setNewOpen(false)
      setSuccess('İzin talebi oluşturuldu.')
      await Promise.all([load(), balanceQ.mutate()])
    } finally {
      setNewSaving(false)
    }
  }

  const handleReview = async (requestId: string, status: 'approved' | 'rejected', note: string) => {
    setReviewSaving(true)
    try {
      const res = await fetch('/api/leave/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, status, reviewer_note: note || null }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'İşlem başarısız.')
      setReviewTarget(null)
      setSuccess(`Talep ${status === 'approved' ? 'onaylandı' : 'reddedildi'}.`)
      await load()
    } finally {
      setReviewSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/leave?id=${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Silme işlemi başarısız.')
      setDeleteTarget(null)
      setSuccess('İzin talebi silindi.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Silme hatası.')
    } finally {
      setDeleting(false)
    }
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length
  const displayed = tab === 0
    ? requests.filter((r) => r.status === 'pending')
    : requests

  return (
    <div className="p-4 text-ink md:p-6">
      <PageHeader
        title="İzin talepleri"
        subtitle={
          isFirstLoad
            ? <Skeleton className="h-4 w-36" />
            : pendingCount > 0 ? `${pendingCount} talep onay bekliyor` : 'Onay bekleyen talep yok'
        }
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus /> Yeni Talep
          </Button>
        }
      />

      {balance && <AnnualLeaveCard balance={balance} />}

      {error && (
        <Alert tone="danger" className="mb-4">
          <AlertCircle />
          <AlertDescription className="text-ink">{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert tone="success" className="mb-4 pr-12">
          <CircleCheck />
          <AlertDescription className="text-ink">{success}</AlertDescription>
          <Button
            variant="ghost" size="icon-sm" aria-label="Kapat" onClick={() => setSuccess(null)}
            className="absolute top-1.5 right-1.5 text-ink-secondary"
          >
            <X />
          </Button>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs value={String(tab)} onValueChange={(v) => setTab(Number(v))} className="mb-5">
        <TabsList>
          <TabsTrigger value="0">
            Bekleyenler
            {pendingCount > 0 && (
              <StatusBadge tone="warning" label={pendingCount} className="h-[18px] px-1.5" />
            )}
          </TabsTrigger>
          <TabsTrigger value="1">Tümü ({requests.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Content */}
      {isFirstLoad && <ListSkeleton count={4} lines={3} actions={2} />}

      {!isFirstLoad && displayed.length === 0 && (
        <Alert tone="info">
          <Info />
          <AlertDescription className="text-ink">
            {tab === 0 ? 'Onay bekleyen talep bulunmuyor.' : 'Henüz izin talebi oluşturulmamış.'}
          </AlertDescription>
        </Alert>
      )}

      {!isFirstLoad && displayed.length > 0 && (
        <SectionCard title={tab === 0 ? 'Onay bekleyenler' : 'Tüm talepler'} count={displayed.length}>
          {displayed.map((req) => (
            <LeaveCard
              key={req.id}
              request={req}
              onReview={isManager && req.status === 'pending' && req.employee_id !== me?.id ? () => setReviewTarget(req) : undefined}
              onDelete={isManager || (req.employee_id === me?.id && req.status === 'pending') ? () => setDeleteTarget(req) : undefined}
            />
          ))}
        </SectionCard>
      )}

      {/* Dialogs */}
      <NewRequestDialog
        key={newOpen ? 'open' : 'closed'}
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSave={handleNewSave}
        employees={employees}
        saving={newSaving}
      />
      <ReviewDialog
        key={reviewTarget?.id ?? 'none'}
        open={!!reviewTarget}
        request={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onReview={handleReview}
        saving={reviewSaving}
      />

      {/* Silme onay dialog'u */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => { if (!next && !deleting) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>İzin Talebini Sil</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  <strong className="text-ink">{deleteTarget.employees?.full_name}</strong> adlı çalışanın{' '}
                  <strong className="text-ink">{fmtDate(deleteTarget.start_date)} – {fmtDate(deleteTarget.end_date)}</strong>{' '}
                  tarihli izin talebi silinecek.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget?.status === 'approved' && (
            <Alert tone="warning">
              <TriangleAlert />
              <AlertDescription className="text-ink">
                Bu izin onaylıydı. Silme işlemi bu tarihlerdeki &ldquo;İzinli&rdquo; işaretlemelerini de kaldıracaktır.
              </AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>İptal</Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Sil
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Leave Card ───────────────────────────────────────────────

function LeaveCard({
  request,
  onReview,
  onDelete,
}: {
  request: LeaveRequestWithEmployee
  onReview?: () => void
  onDelete?: () => void
}) {
  const emp = request.employees
  const days = dayCount(request.start_date, request.end_date)

  return (
    <SectionRow className="flex-wrap items-start py-3 sm:flex-nowrap">
      <PersonAvatar name={emp?.full_name ?? '?'} size={38} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-bold">{emp?.full_name ?? '—'}</p>
          <p className="text-[0.72rem] text-ink-secondary">{emp?.roles?.name ?? '—'}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <StatusBadge tone="info" label={LEAVE_TYPE_LABELS[request.leave_type]} />
          <p className="text-[0.8rem] font-semibold tabular-nums">
            {fmtDate(request.start_date)} – {fmtDate(request.end_date)}
          </p>
          <p className="text-xs text-ink-secondary">{days} gün</p>
        </div>
        {request.reason && <p className="mt-1 text-xs text-ink-secondary">{request.reason}</p>}
        {request.reviewer_note && (
          <p className="mt-0.5 text-xs text-ink-secondary">Yönetici notu: {request.reviewer_note}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <LeaveStatusChip status={request.status} />
        {onReview && (
          <Button variant="outline" size="sm" onClick={onReview} title="İncele ve karar ver">
            İncele
          </Button>
        )}
        {onDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onDelete}
                aria-label="İzin talebini sil"
                className="text-ink-secondary hover:text-danger"
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>İzin talebini sil</TooltipContent>
          </Tooltip>
        )}
      </div>
    </SectionRow>
  )
}

