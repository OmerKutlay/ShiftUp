'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  Box,
  Typography,
  Button,
  Skeleton,
  Alert,
  Tab,
  Tabs,
  Tooltip,
  IconButton,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
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
import { AlertCircle, Check, Loader2, Trash2, TriangleAlert, X } from 'lucide-react'
import { Alert as UiAlert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button as UiButton } from '@/components/ui/button'
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
            <UiAlert tone="danger" className="sm:col-span-2">
              <AlertCircle />
              <AlertDescription className="text-ink">{error}</AlertDescription>
            </UiAlert>
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
          <UiButton type="button" variant="ghost" onClick={onClose} disabled={saving}>İptal</UiButton>
          <UiButton type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Talebi Gönder
          </UiButton>
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
            <UiAlert tone="danger">
              <AlertCircle />
              <AlertDescription className="text-ink">{error}</AlertDescription>
            </UiAlert>
          )}

          <div className="rounded-xl bg-surface-muted px-4 py-3">
            <p className="text-sm font-bold text-ink">{emp?.full_name ?? '—'}</p>
            {emp?.role && <p className="text-xs text-ink-secondary">{emp.role}</p>}
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
          <UiButton type="button" variant="ghost" onClick={onClose} disabled={saving}>İptal</UiButton>
          <UiButton
            type="button"
            variant="outline"
            onClick={() => handle('rejected')}
            disabled={saving}
            className="text-danger hover:bg-danger-soft hover:text-danger"
          >
            <X />
            Reddet
          </UiButton>
          <UiButton type="button" onClick={() => handle('approved')} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Onayla
          </UiButton>
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
      <Alert severity="info" sx={{ mb: 2 }}>
        Yıllık izin bakiyeniz hesaplanamadı: işe giriş tarihiniz kayıtlı değil. Yöneticinizden eklemesini isteyin.
      </Alert>
    )
  }
  const low = balance.remainingDays <= 2
  return (
    <Box sx={{ mb: 2 }}>
      <StatGrid min={140} className="mb-2 md:mb-2">
        <StatCard label={`Yıllık hak (${balance.seniorityYears}. yıl)`} value={`${balance.entitlementDays} gün`} />
        <StatCard label="Kullanılan" value={`${balance.usedDays} gün`} />
        <StatCard label="Onay bekleyen" value={`${balance.pendingDays} gün`} valueColor={balance.pendingDays ? C.warning : undefined} />
        <StatCard label="Kalan" value={`${Math.max(0, balance.remainingDays)} gün`} valueColor={low ? C.warning : C.success} />
      </StatGrid>
      <Typography variant="caption" color="text.secondary">
        Dönem: {balance.periodStart && fmtDate(balance.periodStart)} – {balance.periodEnd && fmtDate(balance.periodEnd)} · Pazar ve resmi tatiller izinden sayılmaz
      </Typography>
    </Box>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export function LeavePage() {
  const { employee: me } = useAuth()
  const isManager = hasRole(me?.roles?.name ?? me?.role_name ?? null, MANAGER_ROLES)
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
    <Box sx={{ p: { xs: 2, md: 3 }, color: 'text.primary' }}>
      <PageHeader
        title="İzin talepleri"
        subtitle={
          isFirstLoad
            ? <Skeleton width={150} />
            : pendingCount > 0 ? `${pendingCount} talep onay bekliyor` : 'Onay bekleyen talep yok'
        }
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setNewOpen(true)}
            sx={{ fontWeight: 700 }}
          >
            Yeni Talep
          </Button>
        }
      />

      {balance && <AnnualLeaveCard balance={balance} />}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v as number)}
        sx={{ mb: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              Bekleyenler
              {pendingCount > 0 && (
                <StatusBadge tone="warning" label={pendingCount} className="h-[18px] px-1.5" />
              )}
            </Box>
          }
        />
        <Tab label={`Tümü (${requests.length})`} />
      </Tabs>

      {/* Content */}
      {isFirstLoad && <ListSkeleton count={4} lines={3} actions={2} />}

      {!isFirstLoad && displayed.length === 0 && (
        <Alert severity="info">
          {tab === 0 ? 'Onay bekleyen talep bulunmuyor.' : 'Henüz izin talebi oluşturulmamış.'}
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
            <UiAlert tone="warning">
              <TriangleAlert />
              <AlertDescription className="text-ink">
                Bu izin onaylıydı. Silme işlemi bu tarihlerdeki &ldquo;İzinli&rdquo; işaretlemelerini de kaldıracaktır.
              </AlertDescription>
            </UiAlert>
          )}
          <AlertDialogFooter>
            <UiButton type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>İptal</UiButton>
            <UiButton type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Sil
            </UiButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Box>
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
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography fontSize="0.875rem" fontWeight={700}>{emp?.full_name ?? '—'}</Typography>
          <Typography fontSize="0.72rem" color="text.secondary">{emp?.role ?? '—'}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
          <StatusBadge tone="info" label={LEAVE_TYPE_LABELS[request.leave_type]} />
          <Typography fontSize="0.8rem" fontWeight={600}>
            {fmtDate(request.start_date)} – {fmtDate(request.end_date)}
          </Typography>
          <Typography fontSize="0.75rem" color="text.secondary">{days} gün</Typography>
        </Box>
        {request.reason && (
          <Typography fontSize="0.75rem" color="text.secondary" sx={{ mt: 0.5 }}>
            {request.reason}
          </Typography>
        )}
        {request.reviewer_note && (
          <Typography fontSize="0.75rem" color="text.secondary" sx={{ mt: 0.25 }}>
            Yönetici notu: {request.reviewer_note}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <LeaveStatusChip status={request.status} />
        {onReview && (
          <Tooltip title="İncele ve Karar Ver">
            <Button variant="outlined" size="small" onClick={onReview}>
              İncele
            </Button>
          </Tooltip>
        )}
        {onDelete && (
          <Tooltip title="İzin Talebini Sil">
            <IconButton
              size="small"
              onClick={onDelete}
              aria-label="İzin talebini sil"
              sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </SectionRow>
  )
}

// İçe aktarılan tüm bileşenler kullanımda
