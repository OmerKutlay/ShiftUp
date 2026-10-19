'use client'

/**
 * TimeCorrectionReviewPanel — Yönetici mesai düzeltme paneli
 * 1) Bekleyen çalışan taleplerini onayla/reddet
 * 2) Herhangi bir çalışan için doğrudan mesai düzeltmesi gir
 */
import { useState } from 'react'
import useSWR from 'swr'
import { AlertCircle, Check, CheckCircle2, Clock, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { TimeCorrectionRequest } from '@/types/timeCorrection'
import { TIME_CORRECTION_STATUS_LABELS, TIME_CORRECTION_STATUS_TONES } from '@/types/timeCorrection'
import { DateField, EmployeeSelect, ListSkeleton, PersonAvatar } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { apiFetch } from '@/lib/api/http'
import { fetchActiveEmployees } from '@/lib/api/employees'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'
import { fmtTime, TimePill, ViolationList } from './timeCorrectionUi'

/** 422 WORKING_TIME_VIOLATION yanıtındaki ihlal listesi */
interface ApiResult { error?: string; code?: string; violations?: string[] }

function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00:00'), 'd MMMM yyyy EEEE', { locale: tr }) } catch { return d }
}
function fmtDateTime(iso: string) {
  try { return format(new Date(iso), 'd MMM HH:mm', { locale: tr }) } catch { return iso }
}

function ErrorAlert({ children }: { children: React.ReactNode }) {
  return (
    <Alert tone="danger">
      <AlertCircle />
      <AlertDescription className="text-ink">{children}</AlertDescription>
    </Alert>
  )
}

const APPROVE_CLS = 'bg-success text-white hover:bg-success/90'
const REJECT_CLS = 'text-danger hover:bg-danger-soft'

export function TimeCorrectionReviewPanel() {
  const [tab, setTab] = useState<'requests' | 'direct'>('requests')
  const { employee: me } = useAuth()

  // ── Talepler sekmesi ─────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending')
  const requestsQ = useSWR(
    `/api/time-correction${statusFilter === 'pending' ? '?status=pending' : ''}`,
    (url: string) => apiFetch<{ requests: TimeCorrectionRequest[] }>(url)
  )
  const requests = requestsQ.data?.requests ?? []
  const isFirstLoad = !requestsQ.data && !requestsQ.error
  const error = requestsQ.error ? (requestsQ.error instanceof Error ? requestsQ.error.message : 'Yüklenemedi.') : null

  const [reviewDialog, setReviewDialog] = useState<{
    open: boolean
    req: TimeCorrectionRequest | null
    action: 'approve' | 'reject'
  }>({ open: false, req: null, action: 'approve' })
  const [reviewNote, setReviewNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  // Çalışma süresi ihlalleri — yönetici açıkça onaylarsa istek tekrar gönderilir
  const [reviewViolations, setReviewViolations] = useState<string[]>([])

  // ── Doğrudan giriş sekmesi ───────────────────────────────────
  const employees = useSWR('employees:active', fetchActiveEmployees).data ?? []
  const [directForm, setDirectForm] = useState({ employee_id: '', date: '', start: '09:00', end: '18:00', reason: '' })
  const [directSaving, setDirectSaving] = useState(false)
  const [directError, setDirectError] = useState<string | null>(null)
  const [directSuccess, setDirectSuccess] = useState<string | null>(null)
  const [directViolations, setDirectViolations] = useState<string[]>([])

  const loadRequests = () => requestsQ.mutate()

  const openReview = (req: TimeCorrectionRequest, action: 'approve' | 'reject') => {
    setReviewDialog({ open: true, req, action })
    setReviewNote('')
    setReviewError(null)
    setReviewViolations([])
  }
  const closeReview = () => setReviewDialog((d) => ({ ...d, open: false }))

  const handleReview = async (acknowledge = false) => {
    if (!reviewDialog.req) return
    setReviewing(true); setReviewError(null)
    try {
      const res = await fetch('/api/time-correction/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          request_id: reviewDialog.req.id,
          status: reviewDialog.action === 'approve' ? 'approved' : 'rejected',
          reviewer_note: reviewNote.trim() || null,
          acknowledge_violations: acknowledge,
        }),
      })
      const d = await res.json() as ApiResult
      if (!res.ok) {
        if (d.code === 'WORKING_TIME_VIOLATION') setReviewViolations(d.violations ?? [])
        setReviewError(d.error ?? 'Hata.')
        return
      }
      setReviewDialog({ open: false, req: null, action: 'approve' })
      setReviewViolations([])
      void loadRequests()
    } catch { setReviewError('Bağlantı hatası.') }
    finally { setReviewing(false) }
  }

  const handleDirect = async (acknowledge = false) => {
    if (!directForm.employee_id || !directForm.date || !directForm.start || !directForm.end || !directForm.reason.trim()) {
      setDirectError('Tüm alanlar zorunludur.'); return
    }
    if (directForm.start === directForm.end) {
      setDirectError('Giriş ve çıkış saati aynı olamaz.'); return
    }
    setDirectSaving(true); setDirectError(null); setDirectSuccess(null)
    try {
      const res = await fetch('/api/time-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          direct: true,
          employee_id:          directForm.employee_id,
          date:                 directForm.date,
          requested_start_time: directForm.start,
          requested_end_time:   directForm.end,
          reason:               directForm.reason.trim(),
          acknowledge_violations: acknowledge,
        }),
      })
      const d = await res.json() as ApiResult
      if (!res.ok) {
        if (d.code === 'WORKING_TIME_VIOLATION') setDirectViolations(d.violations ?? [])
        setDirectError(d.error ?? 'Hata.')
        return
      }
      setDirectSuccess('Mesai düzeltmesi uygulandı.')
      setDirectViolations([])
      setDirectForm((f) => ({ ...f, date: '', start: '09:00', end: '18:00', reason: '' }))
    } catch { setDirectError('Bağlantı hatası.') }
    finally { setDirectSaving(false) }
  }

  const reviewReq = reviewDialog.req
  const isApprove = reviewDialog.action === 'approve'
  const hasReviewViolations = reviewViolations.length > 0

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup type="single" value={tab} aria-label="Görünüm"
          onValueChange={(v) => { if (v) setTab(v as 'requests' | 'direct') }}>
          <ToggleGroupItem value="requests">Çalışan talepleri</ToggleGroupItem>
          <ToggleGroupItem value="direct">Doğrudan düzeltme</ToggleGroupItem>
        </ToggleGroup>
        {tab === 'requests' && (
          <ToggleGroup type="single" value={statusFilter} aria-label="Durum filtresi"
            onValueChange={(v) => { if (v) setStatusFilter(v as 'pending' | 'all') }}>
            <ToggleGroupItem value="pending">Bekleyenler</ToggleGroupItem>
            <ToggleGroupItem value="all">Tümü</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {/* ── Çalışan talepleri ── */}
      {tab === 'requests' && (
        <>
          {error && (
            <Alert tone="danger">
              <AlertCircle />
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-ink">
                <span>{error}</span>
                <Button size="sm" variant="outline" onClick={() => void loadRequests()}>
                  <RefreshCw />
                  Tekrar dene
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {isFirstLoad ? (
            <ListSkeleton count={3} lines={3} actions={2} dense />
          ) : requests.length === 0 ? (
            <p className="rounded-2xl border bg-card px-4 py-8 text-center text-sm text-ink-secondary">
              {statusFilter === 'pending' ? 'Bekleyen talep yok.' : 'Talep bulunamadı.'}
            </p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t">
              {requests.map((r) => {
                const name = r.employee?.full_name ?? '—'
                return (
                  <li key={r.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <PersonAvatar name={name} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold">{name}</span>
                          <Badge tone={TIME_CORRECTION_STATUS_TONES[r.status]}>{TIME_CORRECTION_STATUS_LABELS[r.status]}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-ink-secondary">{fmtDate(r.date)}</span>
                          <TimePill start={r.requested_start_time} end={r.requested_end_time} />
                        </div>
                        <p className="mt-1.5 text-sm text-ink-secondary [overflow-wrap:anywhere]">{r.reason}</p>
                        {r.reviewer_note && (
                          <p className="mt-1 text-xs text-ink-muted [overflow-wrap:anywhere]">Not: {r.reviewer_note}</p>
                        )}
                        <p className="mt-1 text-xs text-ink-muted">
                          Oluşturuldu: {fmtDateTime(r.created_at)}
                          {r.reviewed_at && ` · İncelendi: ${fmtDateTime(r.reviewed_at)}`}
                        </p>
                      </div>
                    </div>

                    {r.status === 'pending' && (
                      <div className="flex shrink-0 gap-2 pl-12 sm:pl-0">
                        <Button size="sm" className={APPROVE_CLS} onClick={() => openReview(r, 'approve')}>
                          <Check />
                          Onayla
                        </Button>
                        <Button size="sm" variant="outline" className={REJECT_CLS} onClick={() => openReview(r, 'reject')}>
                          <X />
                          Reddet
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {/* ── Doğrudan düzeltme ── */}
      {tab === 'direct' && (
        <section className="grid max-w-[480px] gap-4 rounded-2xl border bg-card p-4">
          <p className="text-sm text-ink-secondary">
            Çalışan talebi olmadan doğrudan mesai düzeltmesi girin. Anında uygulanır.
          </p>

          {directError && <ErrorAlert>{directError}</ErrorAlert>}
          <ViolationList items={directViolations} />
          {directSuccess && (
            <Alert tone="success">
              <CheckCircle2 />
              <AlertDescription className="text-ink">{directSuccess}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-1.5">
            <EmployeeSelect
              employees={employees.filter((emp) => emp.id !== me?.id)}
              value={directForm.employee_id}
              label="Çalışan"
              onChange={(id) => {
                setDirectViolations([])
                setDirectForm((f) => ({ ...f, employee_id: id }))
              }}
              fullWidth
            />
            <p className="text-xs text-ink-muted">
              Kendi mesai düzeltmeniz için “Mesai düzeltme” sayfasından talep oluşturun; başka bir yönetici onaylar.
            </p>
          </div>

          <DateField size="small" label="Tarih" value={directForm.date}
            onChange={(v) => setDirectForm((f) => ({ ...f, date: v }))} fullWidth />

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="tc-direct-start">Giriş saati</Label>
              <Input id="tc-direct-start" type="time" step={300} value={directForm.start}
                onChange={(e) => setDirectForm((f) => ({ ...f, start: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tc-direct-end">Çıkış saati</Label>
              <Input id="tc-direct-end" type="time" step={300} value={directForm.end}
                onChange={(e) => setDirectForm((f) => ({ ...f, end: e.target.value }))} />
            </div>
          </div>
          {directForm.end < directForm.start && (
            <p className="-mt-2 text-xs text-ink-secondary">
              Çıkış saati girişten önce — ertesi gün çıkış olarak işlenecek (gece vardiyası).
            </p>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="tc-direct-reason">Sebep</Label>
            <Textarea id="tc-direct-reason" rows={2} value={directForm.reason}
              onChange={(e) => setDirectForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>

          {directViolations.length > 0 ? (
            <Button className="bg-warning text-white hover:bg-warning/90" disabled={directSaving}
              onClick={() => void handleDirect(true)}>
              {directSaving ? <Loader2 className="animate-spin" /> : <Plus />}
              İhlalleri onaylayarak uygula
            </Button>
          ) : (
            <Button onClick={() => void handleDirect()} disabled={directSaving}>
              {directSaving ? <Loader2 className="animate-spin" /> : <Plus />}
              Düzeltmeyi uygula
            </Button>
          )}
        </section>
      )}

      {/* Onay / red penceresi */}
      <Dialog open={reviewDialog.open} onOpenChange={(o) => { if (!o && !reviewing) closeReview() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isApprove ? 'Talebi onayla' : 'Talebi reddet'}</DialogTitle>
            {reviewReq && (
              <DialogDescription asChild>
                <div className="mt-1 flex items-center gap-3 rounded-xl bg-surface-muted p-3">
                  <PersonAvatar name={reviewReq.employee?.full_name ?? '—'} size={32} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{reviewReq.employee?.full_name}</p>
                    <p className="text-xs text-ink-secondary">
                      {fmtDate(reviewReq.date)} · {fmtTime(reviewReq.requested_start_time)} – {fmtTime(reviewReq.requested_end_time)}
                    </p>
                  </div>
                </div>
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="grid gap-3">
            {reviewError && <ErrorAlert>{reviewError}</ErrorAlert>}
            <ViolationList items={reviewViolations} />
            <div className="grid gap-1.5">
              <Label htmlFor="tc-review-note">Yönetici notu (opsiyonel)</Label>
              <Textarea id="tc-review-note" rows={2} value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder={isApprove ? undefined : 'Red sebebini belirtebilirsiniz...'} />
            </div>
            {isApprove && (
              <Alert tone="info">
                <Clock />
                <AlertDescription className="text-ink">
                  Onaylandığında çalışanın devam kaydı ve çalışma özeti güncellenir; planlanan vardiya korunur.
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeReview} disabled={reviewing}>İptal</Button>
            <Button
              onClick={() => void handleReview(hasReviewViolations)}
              disabled={reviewing}
              variant={!hasReviewViolations && !isApprove ? 'destructive' : 'default'}
              className={cn(hasReviewViolations ? 'bg-warning text-white hover:bg-warning/90' : isApprove && APPROVE_CLS)}
            >
              {reviewing ? <Loader2 className="animate-spin" /> : isApprove ? <Check /> : <X />}
              {hasReviewViolations ? 'İhlallere rağmen onayla' : isApprove ? 'Onayla' : 'Reddet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
