'use client'

/**
 * TimeCorrectionPage — Devam ve izin › Mesai düzeltme
 *
 * Çalışan: talep formu kartı (Field) + kendi talepleri (Item listesi).
 * Yönetici: sekmeler — "Çalışan talepleri" (onay / red), "Doğrudan düzeltme", "Taleplerim"
 * (kendi talep formu ve listesi; kendi talebini başka bir yönetici onaylar).
 */
import { useState } from 'react'
import useSWR from 'swr'
import { FileClock, Info, Send, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { apiFetch } from '@/lib/api/http'
import type { TimeCorrectionRequest } from '@/types/timeCorrection'
import { DateField, Page, PageHeader, PageSkeleton, PageTabsList, TabLabel } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  DirectCorrectionCard, EmployeeRequestsReview, ListSkeletonRows, PENDING_CORRECTIONS_KEY,
} from './TimeCorrectionReviewPanel'
import { CorrectionStatusBadge, fmtDateTime, fmtDay, TimeRange } from './timeCorrectionUi'

const EMPTY_FORM = { date: '', start: '09:00', end: '18:00', reason: '' }

// ─── Talep formu ─────────────────────────────────────────────

function RequestFormCard({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!form.date || !form.start || !form.end || !form.reason.trim()) {
      setSaveError('Tüm alanlar zorunludur.'); return
    }
    // Çıkış girişten önceyse ertesi gün sayılır (gece vardiyası)
    if (form.start === form.end) {
      setSaveError('Giriş ve çıkış saati aynı olamaz.'); return
    }
    setSaving(true); setSaveError(null)
    try {
      const res = await fetch('/api/time-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          date: form.date,
          requested_start_time: form.start,
          requested_end_time: form.end,
          reason: form.reason.trim(),
        }),
      })
      const d = await res.json() as { error?: string }
      if (!res.ok) { setSaveError(d.error ?? 'Hata oluştu.'); return }
      setForm(EMPTY_FORM)
      toast.success('Talebiniz yöneticinize iletildi')
      onCreated()
    } catch { setSaveError('Bağlantı hatası.') }
    finally { setSaving(false) }
  }

  return (
    <Card className="gap-0 py-0 shadow-xs">
      <CardHeader className="border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
        <CardTitle>Yeni düzeltme talebi</CardTitle>
        <CardDescription>Onaylanınca devam kaydınız güncellenir.</CardDescription>
      </CardHeader>
      <CardContent className="px-4 py-5 md:px-6">
        <FieldGroup className="gap-5">
          <DateField label="Tarih" value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} fullWidth />
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="tc-start">Giriş saati</FieldLabel>
              <Input id="tc-start" type="time" step={300} value={form.start} className="tabular-nums"
                onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="tc-end">Çıkış saati</FieldLabel>
              <Input id="tc-end" type="time" step={300} value={form.end} className="tabular-nums"
                onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
            </Field>
          </div>
          {form.end < form.start && (
            <Alert tone="info">
              <Info />
              <AlertDescription>Çıkış girişten önce — ertesi gün çıkış olarak işlenecek (gece vardiyası).</AlertDescription>
            </Alert>
          )}
          <Field data-invalid={!!saveError || undefined}>
            <FieldLabel htmlFor="tc-reason">Açıklama</FieldLabel>
            <Textarea id="tc-reason" rows={3} value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Örn: QR ile çıkış yapmayı unuttum" />
            {saveError ? <FieldError>{saveError}</FieldError> : <FieldDescription>Ne olduğunu kısaca yazın; yöneticiniz görür.</FieldDescription>}
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="border-t px-4 py-4 md:px-6 [.border-t]:pt-4">
        <Button onClick={() => void handleSubmit()} disabled={saving} className="w-full">
          {saving ? <Spinner /> : <Send />}
          Talebi gönder
        </Button>
      </CardFooter>
    </Card>
  )
}

// ─── Kendi talepleri ─────────────────────────────────────────

function MyRequests({ requests, loading }: { requests: TimeCorrectionRequest[]; loading: boolean }) {
  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-xs">
      <CardHeader className="border-b px-4 py-4 md:px-6 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-2">
          Taleplerim
          {!loading && <Badge variant="secondary" className="tabular-nums">{requests.length}</Badge>}
        </CardTitle>
        <CardDescription>Gönderdiğiniz düzeltme talepleri ve durumları</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {loading ? <ListSkeletonRows /> : requests.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FileClock /></EmptyMedia>
              <EmptyTitle>Henüz talebiniz yok</EmptyTitle>
              <EmptyDescription>Eksik ya da hatalı bir giriş–çıkış kaydı için formu doldurun.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="divide-y">
            {requests.map((r) => (
              <div key={r.id} role="listitem">
                <Item size="sm" className="items-start rounded-none px-4 py-4 md:px-6">
                  <ItemMedia variant="icon"><FileClock /></ItemMedia>
                  <ItemContent className="min-w-0 gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <ItemTitle className="flex-wrap">
                        {fmtDay(r.date)}
                        <TimeRange start={r.requested_start_time} end={r.requested_end_time} />
                      </ItemTitle>
                      <span className="-my-0.5 sm:hidden"><CorrectionStatusBadge status={r.status} /></span>
                    </div>
                    <ItemDescription className="line-clamp-none text-pretty [overflow-wrap:anywhere]">{r.reason}</ItemDescription>
                    {r.reviewer_note && (
                      <ItemDescription className="line-clamp-none text-pretty text-foreground [overflow-wrap:anywhere]">
                        Yönetici notu: {r.reviewer_note}
                      </ItemDescription>
                    )}
                    <p className="text-xs text-muted-foreground">Gönderildi {fmtDateTime(r.created_at)}</p>
                  </ItemContent>
                  <ItemActions className="max-sm:hidden">
                    <CorrectionStatusBadge status={r.status} />
                  </ItemActions>
                </Item>
              </div>
            ))}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Sayfa ───────────────────────────────────────────────────

type ManagerTab = 'review' | 'direct' | 'mine'

export function TimeCorrectionPage() {
  const { employee, status: authStatus } = useAuth()
  const isManager = hasRole(employee?.roles?.access_level ?? null, MANAGER_ROLES)

  const requestsQ = useSWR(
    authStatus === 'authenticated' ? '/api/time-correction' : null,
    (url: string) => apiFetch<{ requests: TimeCorrectionRequest[] }>(url)
  )
  // Yöneticiye uç tüm talepleri döndürür; "Taleplerim" yalnızca kendi talepleri
  const requests = (requestsQ.data?.requests ?? []).filter((r) => !isManager || r.employee_id === employee?.id)
  const isFirstLoad = !requestsQ.data && !requestsQ.error
  const error = requestsQ.error ? (requestsQ.error instanceof Error ? requestsQ.error.message : 'Yüklenemedi.') : null
  // Sekme sayacı — inceleme listesiyle aynı SWR anahtarı (tek istek)
  const pendingQ = useSWR(
    authStatus === 'authenticated' && isManager ? PENDING_CORRECTIONS_KEY : null,
    (url: string) => apiFetch<{ requests: TimeCorrectionRequest[] }>(url)
  )
  const pendingCount = pendingQ.data?.requests.length

  const [managerTab, setManagerTab] = useState<ManagerTab>('review')

  const load = () => {
    void requestsQ.mutate()
    if (isManager) void pendingQ.mutate()
  }

  // ─── Auth guard ──────────────────────────────────────────────
  if (authStatus === 'loading') return <PageSkeleton rows={4} />
  if (authStatus === 'unauthenticated' || !employee) {
    return (
      <Page>
        <Alert tone="warning">
          <TriangleAlert />
          <AlertDescription>Bu sayfayı görmek için giriş yapmanız gerekiyor.</AlertDescription>
        </Alert>
      </Page>
    )
  }

  const loadAlert = error && (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>Talepler yüklenemedi</AlertTitle>
      <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-2">
        <span>{error}</span>
        <Button size="sm" variant="outline" onClick={() => void requestsQ.mutate()}>Tekrar dene</Button>
      </AlertDescription>
    </Alert>
  )

  const ownView = (
    <div className="grid items-start gap-4 md:gap-6 @4xl/main:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <RequestFormCard onCreated={load} />
      <div className="flex min-w-0 flex-col gap-4">
        {loadAlert}
        <MyRequests requests={requests} loading={isFirstLoad} />
      </div>
    </div>
  )

  return (
    <Page>
      <PageHeader
        title="Mesai düzeltme"
        description={isManager
          ? 'Çalışan taleplerini onaylayın, doğrudan düzeltme girin ya da kendi talebinizi oluşturun'
          : 'Eksik veya hatalı giriş–çıkış kayıtları için düzeltme talep edin'}
      />

      {isManager ? (
        <Tabs value={managerTab} onValueChange={(v) => setManagerTab(v as ManagerTab)} className="gap-4">
          {/* Mobilde üç sekme tam genişlikte, kısa etiketlerle — taşma / yatay kaydırma olmasın */}
          <PageTabsList>
            <TabsTrigger value="review" className="max-sm:min-w-0">
              <TabLabel short="Çalışanlar" long="Çalışan talepleri" />
              {!!pendingCount && <Badge variant="secondary" className="tabular-nums">{pendingCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="direct" className="max-sm:min-w-0">
              <TabLabel short="Doğrudan" long="Doğrudan düzeltme" />
            </TabsTrigger>
            <TabsTrigger value="mine" className="max-sm:min-w-0">
              Taleplerim
              {requests.length > 0 && <Badge variant="secondary" className="tabular-nums">{requests.length}</Badge>}
            </TabsTrigger>
          </PageTabsList>
          <TabsContent value="review"><EmployeeRequestsReview /></TabsContent>
          <TabsContent value="direct"><DirectCorrectionCard /></TabsContent>
          <TabsContent value="mine">{ownView}</TabsContent>
        </Tabs>
      ) : ownView}
    </Page>
  )
}
