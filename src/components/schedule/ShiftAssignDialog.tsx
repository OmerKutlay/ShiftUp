'use client'

/**
 * ShiftAssignDialog — hücreden vardiya atama / düzenleme (DESIGN_GUIDE §5 Formlar):
 * "Şablondan" / "Özel saat" sekmeleri, şablonlar seçim kartı (RadioGroup + Field),
 * müsaitlik uyarısı Alert, süre önizlemesi, altta kaldır / haftalık tatil + iptal / kaydet.
 */
import { useState } from 'react'
import { CalendarOff, CircleAlert, CircleCheck, Clock, Moon, Sofa, Trash2, TriangleAlert } from 'lucide-react'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import type { EmployeeAvailability } from '@/types/workforce'
import { netWorkMins, shiftDurationMins } from '@/lib/workingTimeService'
import { PersonAvatar } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { fmtDuration, fmtRange, shiftKindOf } from './scheduleHelpers'
import { ShiftKindBar } from './ScheduleCells'

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

type Mode = 'template' | 'custom'
type FormError = { target: 'template' | 'start' | 'end' | 'form'; message: string }

const toMins = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m }

// ─── Müsaitlik ────────────────────────────────────────────────
function AvailabilityNotice({ records, shiftStart, shiftEnd }: {
  records: EmployeeAvailability[]
  shiftStart?: string
  shiftEnd?: string
}) {
  if (records.length === 0) return null

  if (records.some((r) => !r.is_available)) {
    return (
      <Alert tone="warning">
        <CalendarOff />
        <AlertTitle>Çalışan bu gün müsait değil</AlertTitle>
        <AlertDescription>Gün kapalı olarak işaretlenmiş; yine de vardiya atayabilirsiniz.</AlertDescription>
      </Alert>
    )
  }

  const windows = records.filter((r) => r.is_available)
  let inWindow: boolean | null = null
  if (shiftStart && shiftEnd && windows.length > 0) {
    const ss = toMins(shiftStart)
    const se = toMins(shiftEnd)
    inWindow = windows.some((w) => ss >= toMins(w.start_time) && se <= toMins(w.end_time))
  }
  const windowText = windows.map((w) => fmtRange(w.start_time, w.end_time)).join(', ')

  if (inWindow === false) {
    return (
      <Alert tone="warning">
        <TriangleAlert />
        <AlertTitle>Müsaitlik penceresinin dışında</AlertTitle>
        <AlertDescription>
          <p>Müsait olduğu saatler: <span className="font-medium text-foreground tabular-nums">{windowText}</span>. Yine de kaydedebilirsiniz.</p>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {inWindow ? <CircleCheck aria-hidden className="size-4 text-success" /> : <Clock aria-hidden className="size-4" />}
      {inWindow ? 'Müsaitlik penceresinde' : 'Müsait'}
      <span className="font-medium text-foreground tabular-nums">· {windowText}</span>
    </p>
  )
}

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
  const [mode, setMode] = useState<Mode>(existingAssignment && !existingTpl ? 'custom' : 'template')
  const [selectedTemplateId, setSelectedTemplateId] = useState(existingTpl)
  const [customStart, setCustomStart] = useState(existingAssignment?.start_time.slice(0, 5) ?? '09:00')
  const [customEnd, setCustomEnd] = useState(existingAssignment?.end_time.slice(0, 5) ?? '17:00')
  const [error, setError] = useState<FormError | null>(null)

  // Şablon seçilince özel saat alanlarını da şablondan doldur (kolaylık)
  const handleTemplateChange = (id: string) => {
    setSelectedTemplateId(id)
    if (error?.target === 'template') setError(null)
    const tpl = templates.find((t) => t.id === id)
    if (tpl) {
      setCustomStart(tpl.start_time.slice(0, 5))
      setCustomEnd(tpl.end_time.slice(0, 5))
    }
  }

  // Aktif saat (önizleme ve müsaitlik kontrolü için)
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null
  const activeStart = mode === 'template' ? (selectedTemplate?.start_time.slice(0, 5) ?? customStart) : customStart
  const activeEnd = mode === 'template' ? (selectedTemplate?.end_time.slice(0, 5) ?? customEnd) : customEnd
  const validRange = isValidTime(activeStart) && isValidTime(activeEnd) && activeStart !== activeEnd
  const grossMins = validRange ? shiftDurationMins(activeStart, activeEnd) : 0
  const netMins = validRange ? netWorkMins(activeStart, activeEnd) : 0
  // Bitiş ≤ başlangıç → gece yarısını geçen vardiya
  const isOvernight = validRange && toMins(activeEnd) <= toMins(activeStart)
  const showPreview = validRange && grossMins > 0 && (mode === 'custom' || !!selectedTemplate)

  const fail = (target: FormError['target'], err: unknown, fallback: string) =>
    setError({ target, message: err instanceof Error ? err.message : fallback })

  const handleSave = async () => {
    setError(null)

    if (mode === 'template') {
      if (!selectedTemplateId) { setError({ target: 'template', message: 'Bir vardiya şablonu seçin.' }); return }
      const tpl = templates.find((t) => t.id === selectedTemplateId)
      if (!tpl) { setError({ target: 'template', message: 'Şablon bulunamadı.' }); return }
      try {
        await onSave({
          templateId: selectedTemplateId,
          startTime: tpl.start_time.slice(0, 5),
          endTime: tpl.end_time.slice(0, 5),
        })
      } catch (err) { fail('form', err, 'Bir hata oluştu.') }
      return
    }

    // Özel saat modu
    if (!isValidTime(customStart)) { setError({ target: 'start', message: 'Geçerli bir başlangıç saati girin (SS:DD).' }); return }
    if (!isValidTime(customEnd)) { setError({ target: 'end', message: 'Geçerli bir bitiş saati girin (SS:DD).' }); return }
    if (customStart === customEnd) { setError({ target: 'end', message: 'Başlangıç ve bitiş saati aynı olamaz.' }); return }

    try {
      await onSave({ templateId: null, startTime: customStart, endTime: customEnd })
    } catch (err) { fail('form', err, 'Bir hata oluştu.') }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    setError(null)
    try { await onDelete() } catch (err) { fail('form', err, 'Vardiya kaldırılamadı.') }
  }

  const handleRestDay = async () => {
    if (!onAssignRestDay) return
    setError(null)
    try { await onAssignRestDay() } catch (err) { fail('form', err, 'Tatil atanamadı.') }
  }

  const dateLabel = workDate
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
        .format(new Date(workDate + 'T00:00:00'))
    : ''
  const fieldErr = (target: FormError['target']) => (error?.target === target ? error.message : null)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !loading) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Vardiyayı düzenle' : 'Vardiya ata'}</DialogTitle>
          <DialogDescription className="flex items-center justify-center gap-2 sm:justify-start">
            {employee && <PersonAvatar name={employee.full_name} size={20} />}
            <span><span className="font-medium text-foreground">{employee?.full_name}</span>{dateLabel && <> · {dateLabel}</>}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          {error?.target === 'form' && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Kaydedilemedi</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          {dayAvailability.length > 0 && (
            <AvailabilityNotice records={dayAvailability} shiftStart={activeStart} shiftEnd={activeEnd} />
          )}

          <Tabs value={mode} onValueChange={(v) => { setMode(v as Mode); setError(null) }}>
            <TabsList className="w-full">
              <TabsTrigger value="template">Şablondan</TabsTrigger>
              <TabsTrigger value="custom">Özel saat</TabsTrigger>
            </TabsList>

            <TabsContent value="template" className="mt-2">
              {templates.length === 0 ? (
                <Empty className="border p-6 md:p-6">
                  <EmptyHeader>
                    <EmptyTitle>Vardiya şablonu yok</EmptyTitle>
                    <EmptyDescription>Özel saat sekmesinden saat girerek atayabilirsiniz.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Field data-invalid={!!fieldErr('template') || undefined}>
                  <RadioGroup
                    value={selectedTemplateId}
                    onValueChange={handleTemplateChange}
                    aria-label="Vardiya şablonu"
                    className="-m-1 grid max-h-72 grid-cols-1 gap-2 overflow-y-auto p-1 sm:grid-cols-2"
                  >
                    {templates.map((t) => {
                      const start = t.start_time.slice(0, 5)
                      const end = t.end_time.slice(0, 5)
                      return (
                        <FieldLabel key={t.id} htmlFor={`tpl-${t.id}`} className="[&>*]:data-[slot=field]:p-3">
                          <Field orientation="horizontal" className="gap-3">
                            <ShiftKindBar kind={shiftKindOf(t.name, start, end)} className="h-8 self-center" />
                            <FieldContent className="min-w-0 gap-0.5">
                              <FieldTitle className="w-full truncate">{t.name}</FieldTitle>
                              <FieldDescription className="text-xs tabular-nums">
                                {fmtRange(start, end)} · {fmtDuration(shiftDurationMins(start, end))}
                              </FieldDescription>
                            </FieldContent>
                            <RadioGroupItem value={t.id} id={`tpl-${t.id}`} className="self-center" />
                          </Field>
                        </FieldLabel>
                      )
                    })}
                  </RadioGroup>
                  {fieldErr('template') && <FieldError>{fieldErr('template')}</FieldError>}
                </Field>
              )}
            </TabsContent>

            <TabsContent value="custom" className="mt-2">
              <FieldGroup className="grid grid-cols-2 gap-4">
                <Field data-invalid={!!fieldErr('start') || undefined}>
                  <FieldLabel htmlFor="assign-start">Başlangıç</FieldLabel>
                  <Input
                    id="assign-start"
                    type="time"
                    step={300}
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    aria-invalid={!!fieldErr('start') || undefined}
                  />
                  {fieldErr('start') && <FieldError>{fieldErr('start')}</FieldError>}
                </Field>
                <Field data-invalid={!!fieldErr('end') || undefined}>
                  <FieldLabel htmlFor="assign-end">Bitiş</FieldLabel>
                  <Input
                    id="assign-end"
                    type="time"
                    step={300}
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    aria-invalid={!!fieldErr('end') || undefined}
                  />
                  {fieldErr('end') && <FieldError>{fieldErr('end')}</FieldError>}
                </Field>
                <FieldDescription className="col-span-2">
                  Bitiş başlangıçtan önceyse vardiya gece yarısını geçer.
                </FieldDescription>
              </FieldGroup>
            </TabsContent>
          </Tabs>

          {showPreview && (
            <Item variant="muted" size="sm">
              <ItemMedia variant="icon"><Clock /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="tabular-nums">{fmtRange(activeStart, activeEnd)}</ItemTitle>
                <ItemDescription className="tabular-nums">
                  Brüt {fmtDuration(grossMins)} · mola {fmtDuration(grossMins - netMins)} · net {fmtDuration(netMins)}
                </ItemDescription>
              </ItemContent>
              {isOvernight && (
                <ItemActions>
                  <Badge tone="plum"><Moon />Gece geçen</Badge>
                </ItemActions>
              )}
            </Item>
          )}
        </div>

        <DialogFooter className={cn((isEdit && onDelete) || (!isEdit && onAssignRestDay) ? 'sm:justify-between' : undefined)}>
          {isEdit && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleDelete}
              disabled={loading}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 />
              Vardiyayı kaldır
            </Button>
          ) : !isEdit && onAssignRestDay ? (
            /* Haftalık tatil — yalnızca yeni atama (boş gün) */
            <Button type="button" variant="ghost" onClick={handleRestDay} disabled={loading}>
              <Sofa />
              Haftalık tatil yap
            </Button>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>İptal</Button>
            <Button type="button" onClick={handleSave} disabled={loading}>
              {loading && <Spinner />}
              {isEdit ? 'Güncelle' : 'Ata'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
