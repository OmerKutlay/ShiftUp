'use client'

/**
 * EmployeeOffboardingDialog — "İşten çıkış" akışı (Müdür+).
 * Son çalışma günü + neden + not girilir; onaydan önce etkileri (silinecek vardiyalar, iptal edilecek
 * talepler, kullanılmamış yıllık izin — İş K. Md. 59) önizlenir. Önizleme sunucudan gelir.
 */
import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'

import { TERMINATION_REASONS, TERMINATION_REASON_LABELS, type EmployeeWithRole, type TerminationReason } from '@/types/employee'
import { fetchOffboardingPreview, offboardEmployee, type OffboardingPreview } from '@/lib/api/employees'
import { addDaysToDateString, turkeyToday } from '@/lib/dateUtils'
import { MAX_BACKDATE_DAYS, MAX_FUTURE_DAYS } from '@/lib/offboardingLimits'
import { DateField } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { fmtDate } from './format'

interface Props {
  employee: EmployeeWithRole | null
  onClose: () => void
  onDone: (employee: EmployeeWithRole) => Promise<void> | void
}

export function EmployeeOffboardingDialog({ employee, onClose, onDone }: Props) {
  const today = turkeyToday()
  const [lastDay, setLastDay] = useState(today)
  const [reason, setReason] = useState<TerminationReason | ''>('')
  const [note, setNote] = useState('')
  const [convert, setConvert] = useState(false)
  const [preview, setPreview] = useState<OffboardingPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const id = employee?.id
  const hire = employee?.hire_date ?? null
  const minDate = (() => {
    const floor = addDaysToDateString(today, -MAX_BACKDATE_DAYS)
    return hire && hire > floor ? hire : floor
  })()
  const maxDate = addDaysToDateString(today, MAX_FUTURE_DAYS)
  const dateOk = !!lastDay && lastDay >= minDate && lastDay <= maxDate

  useEffect(() => {
    if (!id || !dateOk) return
    let cancelled = false
    fetchOffboardingPreview(id, lastDay)
      .then((p) => { if (!cancelled) { setPreview(p); setPreviewError(null) } })
      .catch((e) => { if (!cancelled) { setPreview(null); setPreviewError(e instanceof Error ? e.message : 'Önizleme alınamadı.') } })
    return () => { cancelled = true }
  }, [id, lastDay, dateOk])

  const close = () => { if (!busy) onClose() }

  const submit = async () => {
    if (!employee || !reason || !dateOk) return
    setBusy(true)
    setError(null)
    try {
      await offboardEmployee(employee.id, {
        last_day: lastDay,
        reason,
        note: note.trim() || undefined,
        convert_to_open_shifts: convert,
      })
      await onDone(employee)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İşlem başarısız.')
    } finally {
      setBusy(false)
    }
  }

  const cancelled = preview
    ? preview.pending_leave + preview.future_approved_leave + preview.pending_time_corrections + preview.pending_swaps
    : 0
  const shifts = preview?.future_shifts ?? []
  const convertible = shifts.filter((s) => s.can_convert).length
  const conflictDate = preview?.attendance_conflict_date ?? null
  const stores = [...new Set(shifts.map((s) => s.store_name).filter(Boolean))]

  return (
    <Dialog open={!!employee} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>İşten çıkış</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{employee?.full_name}</span> için son çalışma gününü ve nedenini
            girin. Geçmiş kayıtları (vardiya, puantaj, izin) korunur.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-0.5">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel>Son çalışma günü</FieldLabel>
              <DateField
                label="Son çalışma günü"
                hideLabel
                value={lastDay}
                onChange={setLastDay}
                min={minDate}
                max={maxDate}
                fullWidth
              />
              <FieldDescription>
                Bu gün dahil çalışır; hesap ertesi gün pasifleşir. Bugünden önceki bir tarih girerseniz hesap hemen pasifleşir.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="termination-reason">İşten çıkış nedeni</FieldLabel>
              <Select value={reason || undefined} onValueChange={(v) => setReason(v as TerminationReason)}>
                <SelectTrigger id="termination-reason" className="w-full"><SelectValue placeholder="Neden seçin" /></SelectTrigger>
                <SelectContent>
                  {TERMINATION_REASONS.map((r) => <SelectItem key={r} value={r}>{TERMINATION_REASON_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="termination-note">Not (isteğe bağlı)</FieldLabel>
              <Textarea id="termination-note" value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </FieldGroup>

          {conflictDate && (
            <Alert variant="destructive"><TriangleAlert /><AlertTitle>İşten çıkış yapılamaz</AlertTitle><AlertDescription>{conflictDate} günü çalışma kaydı var; son iş günü bu tarihten önce olamaz.</AlertDescription></Alert>
          )}
          {previewError && (
            <Alert variant="destructive"><TriangleAlert /><AlertTitle>Önizleme alınamadı</AlertTitle><AlertDescription>{previewError}</AlertDescription></Alert>
          )}

          {preview && (
            <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="offboarding-preview">
              <p className="font-medium">Onayladığınızda olacaklar</p>
              <ul className="flex list-disc flex-col gap-1.5 pl-5">
                <li>
                  {shifts.length > 0
                    ? `${fmtDate(preview.last_day)} sonrasındaki ${shifts.length} vardiya silinir${convert && convertible > 0 ? ` (bugün ve sonrası ${convertible} tanesi açık vardiyaya çevrilir)` : ''}${stores.length > 1 ? ` — ${stores.join(', ')}` : ''}.`
                    : 'Son günden sonra planlı vardiyası yok.'}
                </li>
                <li>
                  {cancelled > 0
                    ? `${cancelled} bekleyen / ileri tarihli talep (izin, mesai düzeltme, takas) otomatik iptal edilir.`
                    : 'İptal edilecek bekleyen talep yok.'}
                </li>
                <li>
                  {preview.deactivates_now
                    ? 'Hesap hemen pasifleşir; oturumları ve bildirim abonelikleri kapatılır.'
                    : `Hesap ${fmtDate(addDaysToDateString(preview.last_day, 1))} tarihinde pasifleşir; o güne kadar çalışmaya devam eder.`}
                </li>
              </ul>
              {shifts.length > 0 && (
                <div className="flex flex-col gap-2">
                  <ul className="max-h-32 overflow-y-auto rounded-md border bg-background p-2 text-xs tabular-nums">
                    {shifts.map((s) => (
                      <li key={s.id}>
                        {fmtDate(s.work_date)} · {s.start_time}–{s.end_time}{s.store_name ? ` · ${s.store_name}` : ''}
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={convert} onCheckedChange={(v) => setConvert(v === true)} />
                    <span>Açık vardiyaya çevir (yalnızca bugün ve sonrası; diğer çalışanlar alabilir)</span>
                  </label>
                </div>
              )}
              <p className="rounded-md bg-background p-2">
                {preview.leave_balance.known
                  ? <>Kullanılmamış yıllık izin: <strong>{preview.leave_balance.remaining_days} gün</strong>
                    {preview.leave_balance.remaining_days > 0 && ' (ücreti ödenmeli — İş K. Md. 59)'}</>
                  : 'İşe giriş tarihi girilmediği için yıllık izin bakiyesi hesaplanamadı.'}
                {preview.leave_balance.known && (
                  <span className="block text-xs text-muted-foreground">
                    Kapsam: {preview.leave_balance.scope}. Önceki yıllardan devreden izin için bordro ile doğrulayın.
                  </span>
                )}
              </p>
            </div>
          )}

          {error && (
            <Alert variant="destructive"><TriangleAlert /><AlertTitle>İşlem yapılamadı</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={busy}>İptal</Button>
          <Button type="button" variant="destructive" onClick={() => void submit()} disabled={busy || !reason || !dateOk || !preview || !!conflictDate}>
            {busy && <Spinner />}
            İşten çıkışı onayla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
