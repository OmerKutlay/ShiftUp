'use client'
/**
 * OpenShiftsPanel — FAZ 11
 *
 * Rol bazlı görünüm:
 *   Yönetici (manager+): Açık vardiya oluşturabilir, iptal edebilir. Claim yapamaz.
 *   Çalışan:             Açık vardiyaları görür ve kendi adına üstlenebilir.
 *                        "Üstlen" butonu her zaman SESSION'daki çalışan adına işlem yapar —
 *                        UI'da çalışan seçici yoktur.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { AlertCircle, Ban, CheckCircle2, Info, Loader2, Plus, X } from 'lucide-react'
import type { OpenShift } from '@/types/workforce'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { EmptyRow, ListSkeleton, StatusBadge } from '@/components/common'
import type { BadgeTone } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { apiFetch } from '@/lib/api/http'
import { SHIFT_KIND_TONES } from '@/lib/palette'

const STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  filled: 'Dolduruldu',
  cancelled: 'İptal',
}
const STATUS_TONES: Record<string, BadgeTone> = {
  open: 'brand',
  filled: 'success',
  cancelled: 'neutral',
}

const EMPTY_FORM = { work_date: '', start_time: '09:00', end_time: '18:00', role_needed: '', description: '' }

/** Kapatılabilir durum bildirimi (hata / başarı) */
function Notice({ tone, icon, children, onClose }: {
  tone: 'danger' | 'success'; icon: React.ReactNode; children: React.ReactNode; onClose: () => void
}) {
  return (
    <Alert tone={tone} className="mb-3 pr-12">
      {icon}
      <AlertDescription className="text-ink">{children}</AlertDescription>
      <Button
        variant="ghost" size="icon-sm" aria-label="Kapat" onClick={onClose}
        className="absolute top-1.5 right-1.5 text-ink-secondary"
      >
        <X />
      </Button>
    </Alert>
  )
}

export function OpenShiftsPanel() {
  const { employee: authEmployee } = useAuth()
  const isManager = hasRole(
    authEmployee?.roles?.name ?? authEmployee?.role_name ?? null,
    MANAGER_ROLES
  )

  const [actionError, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('open')
  const shiftsQ = useSWR(`/api/open-shifts?status=${statusFilter}`, (url: string) =>
    apiFetch<{ open_shifts: OpenShift[] }>(url)
  )
  const shifts = shiftsQ.data?.open_shifts ?? []
  const isFirstLoad = !shiftsQ.data && !shiftsQ.error
  const error = actionError ?? (shiftsQ.error ? (shiftsQ.error instanceof Error ? shiftsQ.error.message : 'Yüklenemedi.') : null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null)

  // Oluşturma/iptal/üstlenme sonrası önbellekteki liste yerinde güncellenir (yeniden çekmeden)
  const setShifts = (update: (prev: OpenShift[]) => OpenShift[]) =>
    shiftsQ.mutate((d) => ({ open_shifts: update(d?.open_shifts ?? []) }), { revalidate: false })

  // ── Açık vardiya oluştur (yönetici) ─────────────────────────
  const handleCreate = async () => {
    if (!form.work_date) { setError('Tarih zorunludur.'); return }
    setSaving(true)
    setError(null)
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
      if (!res.ok) { setError(json.error ?? 'Kaydedilemedi.'); return }
      // Yeni vardiya "open" filtresindeyse listeye ekle
      if (statusFilter === 'open') {
        setShifts((prev) => [json.open_shift, ...prev])
      }
      setDialogOpen(false)
      setForm(EMPTY_FORM)
    } catch {
      setError('Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  // ── Vardiyayı iptal et (yönetici) ────────────────────────────
  const handleCancel = async (shiftId: string) => {
    setCancellingId(shiftId)
    setError(null)
    try {
      const res = await fetch('/api/open-shifts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: shiftId, status: 'cancelled' }),
      })
      const json = (await res.json()) as { open_shift: OpenShift; error?: string }
      if (!res.ok) { setError(json.error ?? 'İptal edilemedi.'); return }
      setShifts((prev) => prev.map((s) => (s.id === shiftId ? json.open_shift : s)))
    } catch {
      setError('İşlem başarısız.')
    } finally {
      setCancellingId(null)
    }
  }

  // ── Vardiyayı üstlen (çalışan — session üzerinden) ───────────
  const handleClaim = async (shiftId: string) => {
    setClaimingId(shiftId)
    setError(null)
    setClaimSuccess(null)
    try {
      const res = await fetch('/api/open-shifts/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ open_shift_id: shiftId }),
      })
      const json = (await res.json()) as { open_shift: OpenShift; error?: string }
      if (!res.ok) { setError(json.error ?? 'Üstlenme başarısız.'); return }
      setShifts((prev) => prev.map((s) => (s.id === shiftId ? json.open_shift : s)))
      setClaimSuccess('Vardiya başarıyla üstlenildi ve takviminize eklendi.')
    } catch {
      setError('İşlem başarısız.')
    } finally {
      setClaimingId(null)
    }
  }

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div>
      {/* Başlık satırı */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label="Durum" className="min-w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Açık</SelectItem>
            <SelectItem value="filled">Dolduruldu</SelectItem>
            <SelectItem value="cancelled">İptal</SelectItem>
          </SelectContent>
        </Select>

        {/* Oluştur butonu yalnızca yöneticilere görünür */}
        {isManager && (
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            <Plus />
            Açık Vardiya Oluştur
          </Button>
        )}
      </div>

      {/* Çalışan için bilgi notu */}
      {!isManager && statusFilter === 'open' && (
        <Alert tone="info" className="mb-3">
          <Info />
          <AlertDescription className="block text-ink">
            Açık vardiyaları görerek kendi adınıza üstlenebilirsiniz.
            <span className="font-bold"> Üstlen</span> butonuna basmanız yeterli.
          </AlertDescription>
        </Alert>
      )}

      {/* Başarı mesajı */}
      {claimSuccess && (
        <Notice tone="success" icon={<CheckCircle2 />} onClose={() => setClaimSuccess(null)}>
          {claimSuccess}
        </Notice>
      )}

      {/* Hata mesajı */}
      {error && (
        <Notice tone="danger" icon={<AlertCircle />} onClose={() => setError(null)}>
          {error}
        </Notice>
      )}

      {/* Liste */}
      {isFirstLoad ? (
        <ListSkeleton count={4} avatar={false} lines={2} actions={2} dense />
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-card [&>*+*]:border-t">
          {shifts.length === 0 ? (
            <EmptyRow>
              {statusFilter === 'open'
                ? 'Şu an açık vardiya bulunmuyor.'
                : 'Bu durumda vardiya bulunamadı.'}
            </EmptyRow>
          ) : shifts.map((shift) => {
            const start = shift.start_time.slice(0, 5)
            const end = shift.end_time.slice(0, 5)
            const tone = SHIFT_KIND_TONES[shiftKindOf(undefined, start, end)]
            const details = [shift.role_needed, shift.description].filter(Boolean).join(' · ')
            return (
              <div key={shift.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                {/* Sol: vardiya bilgisi */}
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className="inline-flex h-8 shrink-0 items-center rounded-[10px] px-2.5 text-[0.8rem] font-bold tabular-nums"
                    style={{ backgroundColor: tone.soft, color: tone.text }}
                  >
                    {start} – {end}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {format(new Date(shift.work_date), 'd MMMM yyyy', { locale: tr })}
                    </p>
                    {details && (
                      <p className="text-xs text-ink-secondary [overflow-wrap:anywhere]">{details}</p>
                    )}
                  </div>
                </div>

                {/* Sağ: durum + aksiyon */}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <StatusBadge tone={STATUS_TONES[shift.status] ?? 'neutral'} label={STATUS_LABELS[shift.status]} />

                  {/* Açık vardiya — çalışan üstlenebilir, yönetici iptal edebilir */}
                  {shift.status === 'open' && !isManager && (
                    <Button
                      variant="outline" size="sm"
                      onClick={() => void handleClaim(shift.id)}
                      disabled={claimingId === shift.id}
                      className="text-primary"
                    >
                      {claimingId === shift.id ? <Loader2 className="animate-spin" aria-label="Üstleniliyor" /> : 'Üstlen'}
                    </Button>
                  )}

                  {shift.status === 'open' && isManager && (
                    <Button
                      variant="outline" size="sm"
                      title="Vardiyayı iptal et"
                      onClick={() => void handleCancel(shift.id)}
                      disabled={cancellingId === shift.id}
                      className="text-danger"
                    >
                      {cancellingId === shift.id ? <Loader2 className="animate-spin" /> : <Ban />}
                      İptal
                    </Button>
                  )}

                  {/* Dolduruldu — kimin üstlendiği */}
                  {shift.status === 'filled' && shift.filled_by_employee && (
                    <span className="text-xs font-semibold text-success">
                      {shift.filled_by_employee.full_name}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* Açık vardiya oluşturma dialog'u — yalnızca yönetici */}
      {isManager && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Açık Vardiya Oluştur</DialogTitle>
              <DialogDescription>
                Oluşturulan vardiya anonim olarak açık havuza eklenir.
                İstekli çalışanlar kendi hesaplarından üstlenebilir.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              {/* MUI DateField'ın açılır takvimi Radix Dialog içinde tıklanamıyor — yerel tarih alanı */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="os-date">Tarih</Label>
                <Input id="os-date" type="date" required value={form.work_date}
                  onChange={(e) => setForm((f) => ({ ...f, work_date: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="os-start">Başlangıç</Label>
                  <Input id="os-start" type="time" step={300} value={form.start_time}
                    onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="os-end">Bitiş</Label>
                  <Input id="os-end" type="time" step={300} value={form.end_time}
                    onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="os-role">Gerekli pozisyon (opsiyonel)</Label>
                <Input id="os-role" value={form.role_needed}
                  onChange={(e) => setForm((f) => ({ ...f, role_needed: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="os-desc">Açıklama (opsiyonel)</Label>
                <Input id="os-desc" value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>İptal</Button>
              <Button onClick={() => void handleCreate()} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" aria-label="Kaydediliyor" /> : 'Oluştur'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
