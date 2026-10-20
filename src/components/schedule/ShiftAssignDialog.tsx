'use client'

import { useState, useCallback } from 'react'
import { AlertCircle, CalendarOff, CheckCircle2, Clock, Loader2, Moon, Sofa, Trash2, TriangleAlert, X } from 'lucide-react'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import type { EmployeeAvailability } from '@/types/workforce'
import { formatTime } from '@/types/shiftTemplate'
import { shiftDurationMins } from '@/lib/workingTimeService'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { SegmentedControl } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { shiftKindOf } from './scheduleHelpers'

/** Dialog'dan dışarıya çıkan birleşik payload */
export interface ShiftSavePayload {
  templateId: string | null   // şablon modunda dolu, özel saatte null
  startTime: string           // 'HH:MM'
  endTime: string             // 'HH:MM'
}

interface Props {
  open: boolean
  onClose: () => void
  onSave: (payload: ShiftSavePayload) => Promise<void>
  onDelete?: () => Promise<void>
  /** Haftalık tatil atama callback — sadece boş günde gösterilir */
  onAssignRestDay?: () => Promise<void>
  employee: EmployeeWithRole | null
  workDate: string
  templates: ShiftTemplate[]
  existingAssignment?: ShiftAssignmentWithDetails | null
  loading: boolean
  dayAvailability?: EmployeeAvailability[]
}

// ─── Müsaitlik uyarısı ────────────────────────────────────────
function AvailabilityNotice({ records, shiftStart, shiftEnd }: {
  records: EmployeeAvailability[]
  shiftStart?: string
  shiftEnd?: string
}) {
  if (records.length === 0) return null
  const hasOff = records.some((r) => !r.is_available)

  if (hasOff) {
    return (
      <Alert tone="warning">
        <CalendarOff />
        <AlertTitle>Çalışan bu gün müsait değil</AlertTitle>
        <AlertDescription>Off gün olarak işaretlenmiş; yine de atayabilirsiniz.</AlertDescription>
      </Alert>
    )
  }

  const windows = records.filter((r) => r.is_available)
  let inWindow: boolean | null = null
  if (shiftStart && shiftEnd && windows.length > 0) {
    const toMins = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m }
    const ss = toMins(shiftStart); const se = toMins(shiftEnd)
    inWindow = windows.some((w) => ss >= toMins(w.start_time) && se <= toMins(w.end_time))
  }

  const windowBadges = (
    <span className="flex flex-wrap items-center gap-1">
      {windows.map((w, i) => (
        <Badge key={i} tone="neutral" className="tabular-nums">
          {w.start_time.slice(0, 5)}–{w.end_time.slice(0, 5)}
        </Badge>
      ))}
    </span>
  )

  if (inWindow === false) {
    return (
      <Alert tone="warning">
        <TriangleAlert />
        <AlertTitle>Müsaitlik penceresi dışında</AlertTitle>
        <AlertDescription>
          <span>Devam edebilirsiniz. Müsait olduğu saatler:</span>
          {windowBadges}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-secondary">
      <span>Müsait:</span>
      {windowBadges}
      {inWindow === true && (
        <span className="flex items-center gap-1 font-semibold text-success">
          <CheckCircle2 aria-hidden className="size-3.5" />
          Müsaitlik penceresinde
        </span>
      )}
    </div>
  )
}

const fmtDur = (mins: number) => `${Math.floor(mins / 60)}s${mins % 60 > 0 ? ` ${mins % 60}dk` : ''}`

// ─── Saat doğrulama ───────────────────────────────────────────
function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t) && (() => {
    const [h, m] = t.split(':').map(Number)
    return h >= 0 && h <= 23 && m >= 0 && m <= 59
  })()
}

// ─── Ana bileşen ──────────────────────────────────────────────
export function ShiftAssignDialog({
  open, onClose, onSave, onDelete, onAssignRestDay,
  employee, workDate, templates, existingAssignment, loading,
  dayAvailability = [],
}: Props) {
  const isEdit = !!existingAssignment

  // Başlangıç değerleri mevcut atamadan gelir. Diyalog her hücre için ayrı `key` ile
  // açıldığından (bkz. WeeklySchedulePage) state yeniden başlatılır — effect ile senkron gerekmez.
  const existingTpl = existingAssignment?.shift_template_id ?? ''
  const [mode, setMode] = useState<'template' | 'custom'>(existingAssignment && !existingTpl ? 'custom' : 'template')
  const [selectedTemplateId, setSelectedTemplateId] = useState(existingTpl)
  const [customStart, setCustomStart] = useState(existingAssignment?.start_time.slice(0, 5) ?? '09:00')
  const [customEnd, setCustomEnd] = useState(existingAssignment?.end_time.slice(0, 5) ?? '17:00')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Şablon seçilince özel saat alanlarını da şablondan doldur (kolaylık)
  const handleTemplateChange = useCallback((id: string) => {
    setSelectedTemplateId(id)
    const tpl = templates.find((t) => t.id === id)
    if (tpl) {
      setCustomStart(tpl.start_time.slice(0, 5))
      setCustomEnd(tpl.end_time.slice(0, 5))
    }
  }, [templates])

  // Aktif saat (önizleme ve availability kontrolü için)
  const activeStart = mode === 'template'
    ? (templates.find((t) => t.id === selectedTemplateId)?.start_time.slice(0, 5) ?? customStart)
    : customStart
  const activeEnd = mode === 'template'
    ? (templates.find((t) => t.id === selectedTemplateId)?.end_time.slice(0, 5) ?? customEnd)
    : customEnd

  const selectedTemplate = mode === 'template'
    ? (templates.find((t) => t.id === selectedTemplateId) ?? null)
    : null

  const durationMins = isValidTime(activeStart) && isValidTime(activeEnd)
    ? shiftDurationMins(activeStart, activeEnd)
    : 0
  const durationLabel = durationMins > 0 ? fmtDur(durationMins) : null

  // Özel saatte bitiş < başlangıç (gece yarısını geçen)
  const isOvernight = isValidTime(activeStart) && isValidTime(activeEnd) && (() => {
    const [sh, sm] = activeStart.split(':').map(Number)
    const [eh, em] = activeEnd.split(':').map(Number)
    return eh * 60 + em <= sh * 60 + sm
  })()

  const handleSave = async () => {
    setSubmitError(null)

    if (mode === 'template') {
      if (!selectedTemplateId) {
        setSubmitError('Lütfen bir vardiya şablonu seçin.')
        return
      }
      const tpl = templates.find((t) => t.id === selectedTemplateId)
      if (!tpl) { setSubmitError('Şablon bulunamadı.'); return }
      try {
        await onSave({
          templateId: selectedTemplateId,
          startTime: tpl.start_time.slice(0, 5),
          endTime: tpl.end_time.slice(0, 5),
        })
      } catch (err) { setSubmitError(err instanceof Error ? err.message : 'Bir hata oluştu.') }
      return
    }

    // Özel saat modu
    if (!isValidTime(customStart)) { setSubmitError('Geçerli bir başlangıç saati girin (SS:DD).'); return }
    if (!isValidTime(customEnd))   { setSubmitError('Geçerli bir bitiş saati girin (SS:DD).'); return }
    if (customStart === customEnd) { setSubmitError('Başlangıç ve bitiş saati aynı olamaz.'); return }

    try {
      await onSave({ templateId: null, startTime: customStart, endTime: customEnd })
    } catch (err) { setSubmitError(err instanceof Error ? err.message : 'Bir hata oluştu.') }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    setSubmitError(null)
    try { await onDelete() }
    catch (err) { setSubmitError(err instanceof Error ? err.message : 'Silme hatası.') }
  }

  const dateLabel = workDate
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
        .format(new Date(workDate + 'T00:00:00'))
    : ''

  const handleRestDay = async () => {
    if (!onAssignRestDay) return
    setSubmitError(null)
    try { await onAssignRestDay() }
    catch (err) { setSubmitError(err instanceof Error ? err.message : 'Tatil atanamadı.') }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Vardiyayı Düzenle' : 'Vardiya Ata'}</DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-ink">{employee?.full_name}</span>
            {dateLabel && <> · {dateLabel}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          {submitError && (
            <Alert tone="danger" className="pr-10">
              <AlertCircle />
              <AlertDescription className="text-ink">{submitError}</AlertDescription>
              <button
                type="button"
                aria-label="Kapat"
                onClick={() => setSubmitError(null)}
                className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-lg text-ink-secondary hover:bg-card/60"
              >
                <X className="size-4" />
              </button>
            </Alert>
          )}

          {/* Müsaitlik */}
          {dayAvailability.length > 0 && (
            <AvailabilityNotice records={dayAvailability} shiftStart={activeStart} shiftEnd={activeEnd} />
          )}

          {/* Mod seçimi */}
          <SegmentedControl<'template' | 'custom'>
            aria-label="Atama türü"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'template', label: 'Şablon' },
              { value: 'custom', label: 'Özel saat' },
            ]}
            fullWidth
          />

          {/* ── Şablon modu: türüne göre renkli seçilebilir kartlar ── */}
          {mode === 'template' && (
            templates.length === 0 ? (
              <p className="rounded-xl bg-surface-muted px-3 py-2.5 text-sm text-ink-secondary">
                Henüz vardiya şablonu yok. Özel saat ile atayabilirsiniz.
              </p>
            ) : (
              <div role="radiogroup" aria-label="Vardiya şablonu" className="grid grid-cols-2 gap-2">
                {templates.map((t) => {
                  const tone = SHIFT_KIND_TONES[shiftKindOf(t.name, t.start_time, t.end_time)]
                  const selected = t.id === selectedTemplateId
                  const dur = shiftDurationMins(t.start_time.slice(0, 5), t.end_time.slice(0, 5))
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => handleTemplateChange(t.id)}
                      className={cn(
                        'flex min-h-16 min-w-0 flex-col items-start gap-0.5 rounded-xl border-2 px-3 py-2.5 text-left transition-shadow outline-none',
                        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        selected ? 'shadow-[0_2px_8px_rgb(43_33_27/0.10)]' : 'border-transparent hover:shadow-[0_1px_4px_rgb(43_33_27/0.08)]'
                      )}
                      style={{ backgroundColor: tone.soft, borderColor: selected ? tone.text : undefined }}
                    >
                      <span className="flex w-full items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold" style={{ color: tone.text }}>{t.name}</span>
                        {selected && <CheckCircle2 aria-hidden className="size-4 shrink-0" style={{ color: tone.text }} />}
                      </span>
                      <span className="text-xs tabular-nums text-ink-secondary">
                        {formatTime(t.start_time)} – {formatTime(t.end_time)} · {fmtDur(dur)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )
          )}

          {/* ── Özel saat modu ── */}
          {mode === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assign-start">Başlangıç</Label>
                <Input
                  id="assign-start"
                  type="time"
                  step={300}
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="assign-end">Bitiş</Label>
                <Input
                  id="assign-end"
                  type="time"
                  step={300}
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Önizleme — her iki modda da göster */}
          {durationLabel && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold tabular-nums text-ink">
                <Clock aria-hidden className="size-4 text-ink-secondary" />
                {activeStart} – {activeEnd}
                {mode === 'custom' && selectedTemplate && (
                  <span className="truncate font-normal text-ink-muted">(Şablon: {selectedTemplate.name})</span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                {isOvernight && (
                  <Badge tone="plum"><Moon />gece geçen</Badge>
                )}
                <Badge tone="neutral">{durationLabel}</Badge>
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="sm:items-center sm:justify-between">
          {isEdit && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleDelete}
              disabled={loading}
              className="text-danger hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 />
              Kaldır
            </Button>
          ) : !isEdit && onAssignRestDay ? (
            /* Haftalık Tatil — yalnızca yeni atama (boş gün) */
            <Button
              type="button"
              variant="ghost"
              onClick={handleRestDay}
              disabled={loading}
              className="text-plum hover:bg-plum-soft hover:text-plum"
            >
              <Sofa />
              Haftalık Tatil
            </Button>
          ) : <span className="hidden sm:block" />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>İptal</Button>
            <Button type="button" onClick={handleSave} disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}
              {isEdit ? 'Güncelle' : 'Ata'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
