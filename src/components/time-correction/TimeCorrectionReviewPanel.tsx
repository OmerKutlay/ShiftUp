'use client'

/**
 * Yönetici mesai düzeltme parçaları (TimeCorrectionPage sekmelerinde):
 *   EmployeeRequestsReview  çalışan taleplerini listele, onayla / reddet (Dialog)
 *   DirectCorrectionCard    herhangi bir çalışan için doğrudan mesai düzeltmesi gir
 */
import { useState } from 'react'
import useSWR from 'swr'
import { Check, FileClock, Info, Plus, RotateCw, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import type { TimeCorrectionRequest } from '@/types/timeCorrection'
import { DateField, EmployeeSelect, PersonAvatar, SegmentedControl } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemMedia, ItemTitle,
} from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/api/http'
import { fetchActiveEmployees } from '@/lib/api/employees'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'
import { CorrectionStatusBadge, fmtDateTime, fmtDay, fmtTime, TimeRange, ViolationList } from './timeCorrectionUi'

/** 422 WORKING_TIME_VIOLATION yanıtındaki ihlal listesi */
interface ApiResult { error?: string; code?: string; violations?: string[] }

/** Bekleyen talepler — sayfa sekme sayacı da aynı anahtarı kullanır (SWR tekilleştirir) */
export const PENDING_CORRECTIONS_KEY = '/api/time-correction?status=pending'

export function ListSkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="İçerik yükleniyor">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn('flex items-start gap-3 px-4 py-4 md:px-6', i > 0 && 'border-t')}>
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-56 max-w-full" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
          <Skeleton className="h-8 w-36 rounded-md max-sm:hidden" />
        </div>
      ))}
    </div>
  )
}

// ─── Çalışan talepleri ───────────────────────────────────────

type ReviewAction = 'approve' | 'reject'

export function EmployeeRequestsReview() {
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending')
  const requestsQ = useSWR(
    statusFilter === 'pending' ? PENDING_CORRECTIONS_KEY : '/api/time-correction',
    (url: string) => apiFetch<{ requests: TimeCorrectionRequest[] }>(url)
  )
  const requests = requestsQ.data?.requests ?? []
  const isFirstLoad = !requestsQ.data && !requestsQ.error
  const error = requestsQ.error ? (requestsQ.error instanceof Error ? requestsQ.error.message : 'Yüklenemedi.') : null

  const [review, setReview] = useState<{ req: TimeCorrectionRequest; action: ReviewAction } | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  // Çalışma süresi ihlalleri — yönetici açıkça onaylarsa istek tekrar gönderilir
  const [reviewViolations, setReviewViolations] = useState<string[]>([])

  const loadRequests = () => requestsQ.mutate()

  const openReview = (req: TimeCorrectionRequest, action: ReviewAction) => {
    setReview({ req, action })
    setReviewNote('')
    setReviewError(null)
    setReviewViolations([])
  }
  const closeReview = () => setReview(null)

  const handleReview = async (acknowledge = false) => {
    if (!review) return
    setReviewing(true); setReviewError(null)
    try {
      const res = await fetch('/api/time-correction/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          request_id: review.req.id,
          status: review.action === 'approve' ? 'approved' : 'rejected',
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
      const name = review.req.employee?.full_name
      toast.success(`${name ? `${name} adlı çalışanın talebi` : 'Talep'} ${review.action === 'approve' ? 'onaylandı' : 'reddedildi'}`)
      setReview(null)
      setReviewViolations([])
      void loadRequests()
    } catch { setReviewError('Bağlantı hatası.') }
    finally { setReviewing(false) }
  }

  const reviewReq = review?.req ?? null
  const isApprove = review?.action !== 'reject'
  const hasReviewViolations = reviewViolations.length > 0

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <CardHeader className="border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
          <CardTitle className="col-start-1">Çalışan talepleri</CardTitle>
          <CardDescription className="col-start-1">Onaylanan düzeltmeler çalışanın devam kaydına işlenir</CardDescription>
          <CardAction className="self-center max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:mt-1 max-sm:justify-self-start">
            <SegmentedControl
              aria-label="Durum filtresi"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[{ value: 'pending', label: 'Bekleyenler' }, { value: 'all', label: 'Tümü' }]}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {error && (
            <div className="p-4 md:px-6">
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Talepler yüklenemedi</AlertTitle>
                <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-2">
                  <span>{error}</span>
                  <Button size="sm" variant="outline" onClick={() => void loadRequests()}>
                    <RotateCw />
                    Tekrar dene
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}
          {isFirstLoad ? <ListSkeletonRows /> : !error && requests.length === 0 ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FileClock /></EmptyMedia>
                <EmptyTitle>{statusFilter === 'pending' ? 'Bekleyen talep yok' : 'Talep bulunamadı'}</EmptyTitle>
                <EmptyDescription>Çalışanlar mesai düzeltme talebi gönderdiğinde burada listelenir.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="divide-y">
              {requests.map((r) => {
                const name = r.employee?.full_name ?? '—'
                const pending = r.status === 'pending'
                const buttons = pending && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openReview(r, 'reject')}>
                      <X />
                      Reddet
                    </Button>
                    <Button size="sm" onClick={() => openReview(r, 'approve')}>
                      <Check />
                      Onayla
                    </Button>
                  </>
                )
                return (
                  <div key={r.id} role="listitem">
                    <Item size="sm" className="items-start rounded-none px-4 py-4 md:px-6">
                      <ItemMedia><PersonAvatar name={name} size={32} /></ItemMedia>
                      <ItemContent className="min-w-0 gap-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <ItemTitle className="flex-wrap">
                            {name}
                            {r.employee?.roles?.name && (
                              <span className="font-normal text-muted-foreground">{r.employee.roles.name}</span>
                            )}
                          </ItemTitle>
                          {!pending && <span className="-my-0.5 sm:hidden"><CorrectionStatusBadge status={r.status} /></span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <span>{fmtDay(r.date)}</span>
                          <TimeRange start={r.requested_start_time} end={r.requested_end_time} />
                        </div>
                        <ItemDescription className="line-clamp-none text-pretty text-foreground [overflow-wrap:anywhere]">
                          {r.reason}
                        </ItemDescription>
                        {r.reviewer_note && (
                          <ItemDescription className="text-pretty [overflow-wrap:anywhere]">Yönetici notu: {r.reviewer_note}</ItemDescription>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Gönderildi {fmtDateTime(r.created_at)}
                          {r.reviewed_at && ` · İncelendi ${fmtDateTime(r.reviewed_at)}`}
                          {r.reviewer?.full_name && ` · ${r.reviewer.full_name}`}
                        </p>
                      </ItemContent>
                      <ItemActions className="gap-2 max-sm:hidden">
                        {pending ? buttons : <CorrectionStatusBadge status={r.status} />}
                      </ItemActions>
                      {pending && (
                        <ItemFooter className="gap-2 sm:hidden [&>button]:flex-1">{buttons}</ItemFooter>
                      )}
                    </Item>
                  </div>
                )
              })}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      {/* Onay / red penceresi */}
      <Dialog open={!!review} onOpenChange={(o) => { if (!o && !reviewing) closeReview() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{isApprove ? 'Talebi onayla' : 'Talebi reddet'}</DialogTitle>
            <DialogDescription>
              {isApprove
                ? 'Onaylandığında çalışanın devam kaydı ve çalışma özeti güncellenir; planlanan vardiya korunur.'
                : 'Çalışan talebinin reddedildiğini bildirimle görür.'}
            </DialogDescription>
          </DialogHeader>
          {reviewReq && (
            <Item variant="muted" size="sm" className="items-start">
              <ItemMedia><PersonAvatar name={reviewReq.employee?.full_name ?? '—'} size={32} /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>{reviewReq.employee?.full_name ?? '—'}</ItemTitle>
                <ItemDescription className="tabular-nums">
                  {fmtDay(reviewReq.date)} · {fmtTime(reviewReq.requested_start_time)}–{fmtTime(reviewReq.requested_end_time)}
                </ItemDescription>
                <ItemDescription className="line-clamp-none text-pretty text-foreground [overflow-wrap:anywhere]">
                  {reviewReq.reason}
                </ItemDescription>
              </ItemContent>
            </Item>
          )}
          <ViolationList items={reviewViolations} />
          <Field data-invalid={!!reviewError || undefined}>
            <FieldLabel htmlFor="tc-review-note">Yönetici notu</FieldLabel>
            <Textarea
              id="tc-review-note"
              rows={3}
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder={isApprove ? 'İsteğe bağlı' : 'Red sebebini yazabilirsiniz'}
            />
            {reviewError ? <FieldError>{reviewError}</FieldError> : <FieldDescription>Çalışan talebinde görür.</FieldDescription>}
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={closeReview} disabled={reviewing}>İptal</Button>
            <Button
              onClick={() => void handleReview(hasReviewViolations)}
              disabled={reviewing}
              variant={!hasReviewViolations && !isApprove ? 'destructive' : 'default'}
            >
              {reviewing ? <Spinner /> : isApprove ? <Check /> : <X />}
              {hasReviewViolations ? 'İhlallere rağmen onayla' : isApprove ? 'Onayla' : 'Reddet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── Doğrudan düzeltme ───────────────────────────────────────

const EMPTY_DIRECT = { employee_id: '', date: '', start: '09:00', end: '18:00', reason: '' }

export function DirectCorrectionCard() {
  const { employee: me } = useAuth()
  const employees = useSWR('employees:active', fetchActiveEmployees).data ?? []
  const [directForm, setDirectForm] = useState(EMPTY_DIRECT)
  const [directSaving, setDirectSaving] = useState(false)
  const [directError, setDirectError] = useState<string | null>(null)
  const [directViolations, setDirectViolations] = useState<string[]>([])

  const handleDirect = async (acknowledge = false) => {
    if (!directForm.employee_id || !directForm.date || !directForm.start || !directForm.end || !directForm.reason.trim()) {
      setDirectError('Tüm alanlar zorunludur.'); return
    }
    if (directForm.start === directForm.end) {
      setDirectError('Giriş ve çıkış saati aynı olamaz.'); return
    }
    setDirectSaving(true); setDirectError(null)
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
      toast.success('Mesai düzeltmesi uygulandı')
      setDirectViolations([])
      setDirectForm((f) => ({ ...f, date: '', start: '09:00', end: '18:00', reason: '' }))
    } catch { setDirectError('Bağlantı hatası.') }
    finally { setDirectSaving(false) }
  }

  const overnight = directForm.end < directForm.start

  return (
    <Card className="max-w-2xl gap-0 py-0 shadow-xs">
      <CardHeader className="border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
        <CardTitle>Doğrudan düzeltme</CardTitle>
        <CardDescription>Çalışan talebi olmadan mesai düzeltmesi girin; anında uygulanır.</CardDescription>
      </CardHeader>
      <CardContent className="px-4 py-5 md:px-6">
        <FieldGroup className="gap-5">
          <Field>
            <EmployeeSelect
              employees={employees.filter((emp) => emp.id !== me?.id)}
              value={directForm.employee_id}
              label="Çalışan"
              showRole
              onChange={(id) => {
                setDirectViolations([])
                setDirectForm((f) => ({ ...f, employee_id: id }))
              }}
              fullWidth
            />
            <FieldDescription>
              Kendi mesainiz için “Taleplerim” sekmesinden talep oluşturun; başka bir yönetici onaylar.
            </FieldDescription>
          </Field>

          {/* DateField etiketi Label + gap-1.5 kullanır; saat alanları aynı ölçüyle hizalanır */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <DateField label="Tarih" value={directForm.date} className="col-span-2 sm:col-span-1"
              onChange={(v) => setDirectForm((f) => ({ ...f, date: v }))} fullWidth />
            <Field className="gap-1.5">
              <FieldLabel htmlFor="tc-direct-start" className="leading-none">Giriş saati</FieldLabel>
              <Input id="tc-direct-start" type="time" step={300} value={directForm.start} className="tabular-nums"
                onChange={(e) => setDirectForm((f) => ({ ...f, start: e.target.value }))} />
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="tc-direct-end" className="leading-none">Çıkış saati</FieldLabel>
              <Input id="tc-direct-end" type="time" step={300} value={directForm.end} className="tabular-nums"
                onChange={(e) => setDirectForm((f) => ({ ...f, end: e.target.value }))} />
            </Field>
          </div>
          {overnight && (
            <Alert tone="info">
              <Info />
              <AlertDescription>Çıkış girişten önce — ertesi gün çıkış olarak işlenecek (gece vardiyası).</AlertDescription>
            </Alert>
          )}

          <Field data-invalid={!!directError || undefined}>
            <FieldLabel htmlFor="tc-direct-reason">Sebep</FieldLabel>
            <Textarea id="tc-direct-reason" rows={3} value={directForm.reason}
              placeholder="Örn: Okuyucu arızası nedeniyle çıkış kaydedilmedi"
              onChange={(e) => setDirectForm((f) => ({ ...f, reason: e.target.value }))} />
            {directError ? <FieldError>{directError}</FieldError> : <FieldDescription>Not devam kaydına ve denetim kaydına eklenir.</FieldDescription>}
          </Field>
          <ViolationList items={directViolations} />
        </FieldGroup>
      </CardContent>
      <CardFooter className="justify-end border-t px-4 py-4 md:px-6 [.border-t]:pt-4">
        <Button onClick={() => void handleDirect(directViolations.length > 0)} disabled={directSaving}>
          {directSaving ? <Spinner /> : <Plus />}
          {directViolations.length > 0 ? 'İhlalleri onaylayarak uygula' : 'Düzeltmeyi uygula'}
        </Button>
      </CardFooter>
    </Card>
  )
}

