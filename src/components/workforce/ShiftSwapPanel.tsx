'use client'
/**
 * ShiftSwapPanel — FAZ 11
 * Vardiya takas talepleri listesi + yeni talep oluşturma + onay/red.
 *
 * Takas bir taleptir: çalışan kendi vardiyası için talep açar, vardiyalar
 * ancak bir yöneticinin (Müdür Yardımcısı+) onayıyla değişir.
 * Çalışan kendi bekleyen talebini iptal edebilir.
 */
import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, ArrowLeftRight, ArrowRight, Check, Info, Loader2, Plus, TriangleAlert, X } from 'lucide-react'
import type { ShiftSwapRequest, CreateSwapRequestPayload } from '@/types/workforce'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import type { EmployeeWithRole } from '@/types/employee'
import { EmptyRow, ListSkeleton, PersonAvatar, StatusBadge } from '@/components/common'
import type { BadgeTone } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useLoadedKey } from '@/hooks/useLoadedKey'

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  awaiting_target: { label: 'Karşı taraf bekleniyor', tone: 'info' },
  pending:   { label: 'Yönetici onayı bekliyor', tone: 'warning' },
  approved:  { label: 'Onaylandı',     tone: 'success' },
  rejected:  { label: 'Reddedildi',    tone: 'danger' },
  cancelled: { label: 'İptal',         tone: 'neutral' },
}

/** Radix Select boş değer kabul etmez — "karşılık vardiya yok" seçeneği için yer tutucu */
const NO_TARGET_SHIFT = '__none__'

type ReviewStatus = 'accepted' | 'declined' | 'approved' | 'rejected' | 'cancelled'

interface Props {
  employees: EmployeeWithRole[]
  assignments: ShiftAssignmentWithDetails[]
  currentEmployeeId: string | null
  isManager: boolean
}

/** Takas kartındaki taraf: avatar + ad + vardiya */
function SwapParty({ name, shift }: { name: string; shift: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <PersonAvatar name={name} size={32} />
      <div className="min-w-0">
        <p className="truncate text-sm font-bold" title={name}>{name}</p>
        <p className="truncate text-xs text-ink-secondary tabular-nums" title={shift}>{shift}</p>
      </div>
    </div>
  )
}

export function ShiftSwapPanel({ employees, assignments, currentEmployeeId, isManager }: Props) {
  const [swaps, setSwaps] = useState<ShiftSwapRequest[]>([])
  const { isFirstLoad, markLoaded } = useLoadedKey()
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<Partial<CreateSwapRequestPayload>>({})
  const [saving, setSaving] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<{ id: string; note: string } | null>(null)
  // Çalışma süresi ihlali — yönetici açıkça onaylarsa tekrar gönderilir
  const [ackPrompt, setAckPrompt] = useState<{ id: string; violations: string[] } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/shift-swap')
      const json = await res.json() as { swap_requests: ShiftSwapRequest[] }
      setSwaps(json.swap_requests ?? [])
    } catch { setError('Yüklenemedi.') }
    finally { markLoaded() }
  }, [markLoaded])

  useEffect(() => { void load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  const closeDialog = () => { setDialogOpen(false); setForm({}) }

  const handleCreate = async () => {
    if (!form.requester_shift_id || !form.target_id) {
      setError('Vardiyanızı ve takas yapılacak çalışanı seçmelisiniz.'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/shift-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json() as { swap_request: ShiftSwapRequest; error?: string }
      if (!res.ok) { setError(json.error ?? 'Hata.'); return }
      closeDialog()
      await load() // join'li (isimli) kaydı almak için
    } catch { setError('Kaydedilemedi.') }
    finally { setSaving(false) }
  }

  const handleReview = async (swapId: string, status: ReviewStatus, reviewerNote?: string, acknowledge = false) => {
    setReviewingId(swapId)
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
        if (json.code === 'WORKING_TIME_VIOLATION') {
          setAckPrompt({ id: swapId, violations: json.violations ?? [] })
          return
        }
        setError(json.error ?? 'Hata.')
        return
      }
      // Yanıt join içermez — mevcut isim/vardiya bilgilerini koru
      setSwaps((prev) => prev.map((s) => s.id === swapId ? { ...s, ...json.swap_request } : s))
    } catch { setError('İşlem başarısız.') }
    finally { setReviewingId(null) }
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  // Talep eden her zaman oturumdaki çalışandır; yalnızca bugün ve sonrasındaki vardiyalar takas edilebilir
  const myShifts = assignments.filter((a) => a.employee_id === currentEmployeeId && a.work_date >= today)
  const targetShifts = assignments.filter((a) => a.employee_id === form.target_id && a.work_date >= today)

  // Kart içi gösterim: "3 Kas Sal 12:00–20:00"
  const fmtSwapShift = (sh: { work_date: string; start_time: string; end_time: string }) =>
    `${format(new Date(sh.work_date), 'd MMM EEE', { locale: tr })} ${sh.start_time.slice(0,5)}–${sh.end_time.slice(0,5)}`

  const fmtShift = (a: ShiftAssignmentWithDetails) =>
    `${format(new Date(a.work_date), 'd MMM', { locale: tr })} ${a.start_time.slice(0,5)}-${a.end_time.slice(0,5)}`

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-60 text-xs text-ink-secondary">
          Takas, karşı taraf kabul edip bir yönetici onayladıktan sonra uygulanır. Diğer durumlarda vardiyalar değişmez.
        </p>
        <Button variant="outline" onClick={() => setDialogOpen(true)} disabled={!currentEmployeeId}>
          <Plus />
          Takas Talebi Oluştur
        </Button>
      </div>

      {error && (
        <Alert tone="danger" className="mb-3 pr-12">
          <AlertCircle />
          <AlertDescription className="text-ink">{error}</AlertDescription>
          <Button
            variant="ghost" size="icon-sm" aria-label="Kapat" onClick={() => setError(null)}
            className="absolute top-1.5 right-1.5 text-ink-secondary"
          >
            <X />
          </Button>
        </Alert>
      )}

      {isFirstLoad ? (
        <ListSkeleton count={3} lines={2} actions={2} dense />
      ) : swaps.length === 0 ? (
        <section className="rounded-2xl border bg-card">
          <EmptyRow>Takas talebi bulunamadı.</EmptyRow>
        </section>
      ) : (
        <div className="flex flex-col gap-3">
          {swaps.map((swap) => {
            const isPending = swap.status === 'pending'
            const awaitingTarget = isPending && !swap.target_accepted_at
            const meta = STATUS_META[awaitingTarget ? 'awaiting_target' : swap.status]
            const isParty = swap.requester_id === currentEmployeeId || swap.target_id === currentEmployeeId
            // Önce hedef çalışan kabul eder; sonra tarafı olmayan bir yönetici onaylar/reddeder
            const canRespond = awaitingTarget && swap.target_id === currentEmployeeId
            const canReview = isPending && !awaitingTarget && isManager && !isParty
            const canCancel = isPending && swap.requester_id === currentEmployeeId
            const busy = reviewingId === swap.id
            const PartyArrow = swap.target_shift ? ArrowLeftRight : ArrowRight
            return (
              <article key={swap.id} className="rounded-2xl border bg-card p-4">
                {/* Taraflar: talep eden → / ↔ hedef */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <SwapParty
                    name={swap.requester?.full_name ?? '—'}
                    shift={swap.requester_shift ? fmtSwapShift(swap.requester_shift) : '—'}
                  />
                  <PartyArrow
                    className="size-4 text-ink-muted"
                    aria-label={swap.target_shift ? 'karşılıklı takas' : 'vardiya devri'}
                  />
                  {swap.target ? (
                    <SwapParty
                      name={swap.target.full_name}
                      shift={swap.target_shift ? fmtSwapShift(swap.target_shift) : 'vardiya devri'}
                    />
                  ) : <span className="text-sm text-ink-muted">—</span>}
                </div>

                {/* Notlar */}
                {(swap.requester_note || swap.reviewer_note) && (
                  <div className="mt-3 flex flex-col gap-0.5 rounded-xl bg-surface-muted px-3 py-2 text-xs text-ink-secondary [overflow-wrap:anywhere]">
                    {swap.requester_note && <p>Not: {swap.requester_note}</p>}
                    {swap.reviewer_note && <p>Yönetici notu: {swap.reviewer_note}</p>}
                  </div>
                )}

                {/* Durum + aksiyonlar */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={meta.tone} label={meta.label} className="mr-auto" />
                  {canRespond && (
                    <>
                      <Button variant="outline" size="sm" className="text-success"
                        onClick={() => handleReview(swap.id, 'accepted')} disabled={busy}>
                        <Check />
                        Kabul Et
                      </Button>
                      <Button variant="outline" size="sm" className="text-danger"
                        onClick={() => handleReview(swap.id, 'declined')} disabled={busy}>
                        <X />
                        Reddet
                      </Button>
                    </>
                  )}
                  {canReview && (
                    <>
                      <Button variant="outline" size="sm" className="text-success"
                        onClick={() => handleReview(swap.id, 'approved')} disabled={busy}>
                        <Check />
                        Onayla
                      </Button>
                      <Button variant="outline" size="sm" className="text-danger"
                        onClick={() => setRejecting({ id: swap.id, note: '' })} disabled={busy}>
                        <X />
                        Reddet
                      </Button>
                    </>
                  )}
                  {canCancel && (
                    <Button variant="outline" size="sm"
                      onClick={() => handleReview(swap.id, 'cancelled')} disabled={busy}>
                      İptal Et
                    </Button>
                  )}
                  {busy && <Loader2 className="size-4 animate-spin text-ink-muted" aria-label="İşleniyor" />}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {/* Yeni takas talebi dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Takas Talebi Oluştur</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Alert tone="info">
              <Info />
              <AlertDescription className="text-ink">
                Teklifiniz önce seçtiğiniz çalışana, o kabul ederse yönetici onayına gider. Onaylanana kadar vardiyanız değişmez.
              </AlertDescription>
            </Alert>
            {myShifts.length === 0 ? (
              <p className="text-sm text-ink-secondary">Bu hafta takas edilebilecek vardiyanız yok.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="swap-my-shift">Vardiyanız</Label>
                <Select value={form.requester_shift_id ?? ''}
                  onValueChange={(v) => setForm((f) => ({ ...f, requester_shift_id: v }))}>
                  <SelectTrigger id="swap-my-shift" className="w-full"><SelectValue placeholder="Vardiya seçin" /></SelectTrigger>
                  <SelectContent>
                    {myShifts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{fmtShift(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* MUI EmployeeSelect'in açılır listesi Radix Dialog içinde tıklanamıyor — shadcn Select */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="swap-target">Takas yapılacak çalışan</Label>
              <Select value={form.target_id ?? ''}
                onValueChange={(id) => setForm((f) => ({ ...f, target_id: id, target_shift_id: undefined }))}>
                <SelectTrigger id="swap-target" className="w-full"><SelectValue placeholder="Çalışan seçin" /></SelectTrigger>
                <SelectContent>
                  {employees.filter((e) => e.id !== currentEmployeeId).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.target_id && targetShifts.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="swap-target-shift">Karşılığında alınacak vardiya (isteğe bağlı)</Label>
                <Select value={form.target_shift_id ?? NO_TARGET_SHIFT}
                  onValueChange={(v) => setForm((f) => ({ ...f, target_shift_id: v === NO_TARGET_SHIFT ? null : v }))}>
                  <SelectTrigger id="swap-target-shift" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TARGET_SHIFT}>Yok — vardiyamı devret</SelectItem>
                    {targetShifts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{fmtShift(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="swap-note">Not</Label>
              <Input id="swap-note" value={form.requester_note ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, requester_note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>Vazgeç</Button>
            <Button onClick={() => void handleCreate()}
              disabled={saving || !form.requester_shift_id || !form.target_id}>
              {saving ? <Loader2 className="animate-spin" aria-label="Gönderiliyor" /> : 'Onaya Gönder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Red gerekçesi dialog */}
      <Dialog open={rejecting !== null} onOpenChange={(open) => { if (!open) setRejecting(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Takas Talebini Reddet</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="swap-reject-note">Gerekçe (isteğe bağlı)</Label>
            <Textarea id="swap-reject-note" rows={2}
              value={rejecting?.note ?? ''}
              onChange={(e) => setRejecting((r) => r && { ...r, note: e.target.value })} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>Vazgeç</Button>
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

      {/* Çalışma süresi ihlali onayı */}
      <AlertDialog open={ackPrompt !== null} onOpenChange={(open) => { if (!open) setAckPrompt(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Çalışma Süresi İhlali</AlertDialogTitle>
            <AlertDialogDescription>
              Bu takas aşağıdaki İş Kanunu kurallarını ihlal ediyor. Yine de onaylamak istiyor musunuz?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert tone="warning">
            <TriangleAlert />
            <ul className="col-start-2 list-disc space-y-0.5 pl-4 text-sm text-ink">
              {ackPrompt?.violations.map((v) => <li key={v}>{v}</li>)}
            </ul>
          </Alert>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <Button
              className="bg-warning text-white hover:bg-warning/90"
              onClick={() => {
                if (!ackPrompt) return
                void handleReview(ackPrompt.id, 'approved', undefined, true)
                setAckPrompt(null)
              }}>
              İhlallere Rağmen Onayla
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
