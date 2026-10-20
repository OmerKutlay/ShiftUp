'use client'

/**
 * TimeCorrectionPage — Manuel Mesai Düzeltme Talebi
 * Çalışan kendi adına talep oluşturur ve geçmiş taleplerini görür.
 * Yönetici aynı sayfada review panelini de görür.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { AlertCircle, Clock, Loader2, Plus, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { TimeCorrectionReviewPanel } from './TimeCorrectionReviewPanel'
import { DateField, PageHeader, PageSkeleton, ListSkeleton } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { TimeCorrectionRequest } from '@/types/timeCorrection'
import { TIME_CORRECTION_STATUS_LABELS, TIME_CORRECTION_STATUS_TONES } from '@/types/timeCorrection'
import { apiFetch } from '@/lib/api/http'
import { TimePill } from './timeCorrectionUi'

// ─── Helpers ─────────────────────────────────────────────────
function fmtDate(d: string) {
  try { return format(new Date(d + 'T00:00:00'), 'd MMMM yyyy', { locale: tr }) }
  catch { return d }
}
function fmtDateTime(iso: string) {
  try { return format(new Date(iso), 'd MMM HH:mm', { locale: tr }) } catch { return iso }
}

function MyRequests({ requests, loading }: { requests: TimeCorrectionRequest[]; loading: boolean }) {
  if (loading) return <ListSkeleton count={3} lines={3} avatar={false} actions={1} />
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-4 py-10 text-center">
        <Clock className="size-8 text-ink-muted" aria-hidden />
        <p className="text-sm text-ink-secondary">Henüz mesai düzeltme talebiniz yok.</p>
      </div>
    )
  }
  return (
    <ul className="overflow-hidden rounded-2xl border bg-card [&>li+li]:border-t">
      {requests.map((r) => (
        <li key={r.id} className="flex items-start gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">{fmtDate(r.date)}</span>
              <TimePill start={r.requested_start_time} end={r.requested_end_time} />
            </div>
            <p className="mt-1 text-sm text-ink-secondary [overflow-wrap:anywhere]">{r.reason}</p>
            {r.reviewer_note && (
              <p className="mt-1 text-xs text-ink-muted [overflow-wrap:anywhere]">Yönetici notu: {r.reviewer_note}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge tone={TIME_CORRECTION_STATUS_TONES[r.status]}>{TIME_CORRECTION_STATUS_LABELS[r.status]}</Badge>
            <span className="text-xs text-ink-muted">{fmtDateTime(r.created_at)}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function TimeCorrectionPage() {
  const { employee, status: authStatus } = useAuth()

  const requestsQ = useSWR(
    authStatus === 'authenticated' ? '/api/time-correction' : null,
    (url: string) => apiFetch<{ requests: TimeCorrectionRequest[] }>(url)
  )
  const requests = requestsQ.data?.requests ?? []
  const isFirstLoad = !requestsQ.data && !requestsQ.error
  const error = requestsQ.error ? (requestsQ.error instanceof Error ? requestsQ.error.message : 'Yüklenemedi.') : null
  const [managerTab, setManagerTab] = useState<'review' | 'mine'>('review')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form, setForm] = useState({ date: '', start: '09:00', end: '18:00', reason: '' })

  // ── Yükle ───────────────────────────────────────────────────
  const load = () => requestsQ.mutate()

  // ── Talep oluştur ────────────────────────────────────────────
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
      setDialogOpen(false)
      setForm({ date: '', start: '09:00', end: '18:00', reason: '' })
      void load()
    } catch { setSaveError('Bağlantı hatası.') }
    finally { setSaving(false) }
  }

  const openDialog = () => { setSaveError(null); setDialogOpen(true) }

  // ─── Auth guard ──────────────────────────────────────────────
  if (authStatus === 'loading') return <PageSkeleton rows={4} maxWidth={720} />
  if (authStatus === 'unauthenticated' || !employee) {
    return (
      <div className="p-4 md:p-6">
        <Alert tone="warning">
          <AlertCircle />
          <AlertDescription className="text-ink">Bu sayfayı görmek için giriş yapmanız gerekiyor.</AlertDescription>
        </Alert>
      </div>
    )
  }

  const isManager = hasRole(employee.roles?.access_level ?? null, MANAGER_ROLES)

  return (
    <div className="mx-auto w-full max-w-[720px] p-4 md:p-6">
      <PageHeader
        title="Mesai düzeltme"
        subtitle="Eksik veya hatalı giriş/çıkış kayıtları için düzeltme talep edin"
        actions={
          <Button onClick={openDialog}>
            <Plus />
            Yeni talep
          </Button>
        }
      />

      {error && (
        <Alert tone="danger" className="mb-4">
          <AlertCircle />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-ink">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void requestsQ.mutate()}>
              <RefreshCw />
              Tekrar dene
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Yönetici: önce onay bekleyenler (kendi talepleri ayrı sekmede) — mobilde uzun kişisel liste
          onay işini sayfanın en altına gömüyordu */}
      {isManager ? (
        <Tabs value={managerTab} onValueChange={(v) => setManagerTab(v as 'review' | 'mine')}>
          <TabsList>
            <TabsTrigger value="review">Onay bekleyenler</TabsTrigger>
            <TabsTrigger value="mine">
              Taleplerim{requests.length ? ` (${requests.length})` : ''}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="review"><TimeCorrectionReviewPanel /></TabsContent>
          <TabsContent value="mine">{mine}</TabsContent>
        </Tabs>
      ) : mine}

      {/* Talep oluşturma penceresi */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!saving) setDialogOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mesai düzeltme talebi oluştur</DialogTitle>
            <DialogDescription>Talebiniz bir yönetici tarafından onaylanınca devam kaydınız güncellenir.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {saveError && (
              <Alert tone="danger">
                <AlertCircle />
                <AlertDescription className="text-ink">{saveError}</AlertDescription>
              </Alert>
            )}
            <DateField size="small" label="Tarih" value={form.date}
              onChange={(v) => setForm((f) => ({ ...f, date: v }))} fullWidth />
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="tc-start">Giriş saati</Label>
                <Input id="tc-start" type="time" step={300} value={form.start}
                  onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="tc-end">Çıkış saati</Label>
                <Input id="tc-end" type="time" step={300} value={form.end}
                  onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
              </div>
            </div>
            {form.end < form.start && (
              <p className="-mt-2 text-xs text-ink-secondary">
                Çıkış saati girişten önce — ertesi gün çıkış olarak işlenecek (gece vardiyası).
              </p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="tc-reason">Açıklama / sebep</Label>
              <Textarea id="tc-reason" rows={3} value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Örn: QR ile giriş yapmayı unuttum, sistem saatleri yanlış kaydetmiş..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>İptal</Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Gönder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
