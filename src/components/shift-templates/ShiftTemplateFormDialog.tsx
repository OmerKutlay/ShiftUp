'use client'

/**
 * ShiftTemplateFormDialog — vardiya şablonu oluştur / düzenle (DESIGN_GUIDE §5 "Formlar").
 * Diyalog her açılışta yeni `key` ile mount edilir (bkz. ShiftTemplatesPage) → form ilk değerden başlar.
 */
import { useState } from 'react'
import { MoonStar, TriangleAlert } from 'lucide-react'

import type { CreateShiftTemplatePayload, ShiftTemplate, UpdateShiftTemplatePayload } from '@/types/shiftTemplate'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { SHIFT_KIND_LABELS, fmtMins, shiftTiming } from './format'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (payload: CreateShiftTemplatePayload | UpdateShiftTemplatePayload) => Promise<void>
  template?: ShiftTemplate | null
  loading: boolean
}

interface FormState {
  name: string
  start_time: string
  end_time: string
  description: string
  active: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  start_time: '',
  end_time: '',
  description: '',
  active: true,
}

function toFormState(t: ShiftTemplate): FormState {
  return {
    name: t.name,
    start_time: t.start_time.slice(0, 5),   // 'HH:MM:SS' → 'HH:MM'
    end_time: t.end_time.slice(0, 5),
    description: t.description ?? '',
    active: t.active,
  }
}

function isValidTime(val: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(val)) return false
  const [h, m] = val.split(':').map(Number)
  return h >= 0 && h <= 23 && m >= 0 && m <= 59
}

export function ShiftTemplateFormDialog({ open, onClose, onSave, template, loading }: Props) {
  const isEdit = !!template
  const [form, setForm] = useState<FormState>(() => (template ? toFormState(template) : EMPTY_FORM))
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  function validate(): boolean {
    const next: typeof errors = {}
    if (!form.name.trim()) next.name = 'Şablon adı zorunludur.'
    if (!form.start_time) {
      next.start_time = 'Başlangıç saati zorunludur.'
    } else if (!isValidTime(form.start_time)) {
      next.start_time = 'Geçerli bir saat girin (örn: 09:00).'
    }
    if (!form.end_time) {
      next.end_time = 'Bitiş saati zorunludur.'
    } else if (!isValidTime(form.end_time)) {
      next.end_time = 'Geçerli bir saat girin (örn: 18:00).'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleText =
    (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }))
      setErrors((err) => ({ ...err, [field]: undefined }))
    }

  const handleSubmit = async () => {
    if (loading || !validate()) return
    setSubmitError(null)
    try {
      await onSave({
        name: form.name.trim(),
        start_time: form.start_time,
        end_time: form.end_time,
        description: form.description.trim() || null,
        active: form.active,
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Bir hata oluştu.')
    }
  }

  // Önizleme: tür rengi, brüt süre, planlanan mola, net çalışma
  const timing = isValidTime(form.start_time) && isValidTime(form.end_time) && form.start_time !== form.end_time
    ? shiftTiming(form.name || undefined, form.start_time, form.end_time)
    : null

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !loading) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Şablonu düzenle' : 'Yeni vardiya şablonu'}</DialogTitle>
          <DialogDescription>Haftalık planda tek tıkla atanan vardiya saatleri.</DialogDescription>
        </DialogHeader>

        <form id="shift-template-form" noValidate onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}>
          <FieldGroup className="gap-5">
            {submitError && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Kaydedilemedi</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            <Field data-invalid={!!errors.name || undefined}>
              <FieldLabel htmlFor="tpl-name">Şablon adı</FieldLabel>
              <Input
                id="tpl-name"
                placeholder="Açılış, Ortacı, Kapanış…"
                value={form.name}
                onChange={handleText('name')}
                aria-invalid={!!errors.name || undefined}
                autoFocus
              />
              {errors.name ? (
                <FieldError>{errors.name}</FieldError>
              ) : (
                <FieldDescription>Açılış, Ortacı, Kapanış ve Full adları planda kendi rengini alır.</FieldDescription>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.start_time || undefined}>
                <FieldLabel htmlFor="tpl-start">Başlangıç saati</FieldLabel>
                <Input
                  id="tpl-start"
                  type="time"
                  step={300}
                  value={form.start_time}
                  onChange={handleText('start_time')}
                  aria-invalid={!!errors.start_time || undefined}
                  className="tabular-nums"
                />
                <FieldError>{errors.start_time}</FieldError>
              </Field>
              <Field data-invalid={!!errors.end_time || undefined}>
                <FieldLabel htmlFor="tpl-end">Bitiş saati</FieldLabel>
                <Input
                  id="tpl-end"
                  type="time"
                  step={300}
                  value={form.end_time}
                  onChange={handleText('end_time')}
                  aria-invalid={!!errors.end_time || undefined}
                  className="tabular-nums"
                />
                <FieldError>{errors.end_time}</FieldError>
              </Field>
            </div>

            {timing && (
              <Item variant="muted" size="sm" aria-live="polite">
                <ItemMedia>
                  <span aria-hidden className="h-9 w-1 rounded-full" style={{ backgroundColor: timing.tone.fill }} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="tabular-nums">
                    {fmtMins(timing.gross)} · {SHIFT_KIND_LABELS[timing.kind]}
                  </ItemTitle>
                  <ItemDescription className="tabular-nums">
                    {fmtMins(timing.breakMins)} planlanan mola · {fmtMins(timing.net)} net çalışma
                  </ItemDescription>
                </ItemContent>
                {timing.overnight && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MoonStar className="size-3.5" aria-hidden />
                    Ertesi gün biter
                  </span>
                )}
              </Item>
            )}

            <Field>
              <FieldLabel htmlFor="tpl-desc">
                Açıklama <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
              </FieldLabel>
              <Textarea
                id="tpl-desc"
                rows={2}
                className="min-h-16"
                placeholder="Örn: Mağaza açılışı, kasa açılış sayımı"
                value={form.description}
                onChange={handleText('description')}
              />
            </Field>

            {isEdit && (
              <FieldLabel htmlFor="tpl-active">
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Aktif şablon</FieldTitle>
                    <FieldDescription>Pasif şablonlar haftalık planda seçilemez.</FieldDescription>
                  </FieldContent>
                  <Switch
                    id="tpl-active"
                    checked={form.active}
                    onCheckedChange={(checked) => setForm((f) => ({ ...f, active: checked }))}
                  />
                </Field>
              </FieldLabel>
            )}
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>İptal</Button>
          <Button type="submit" form="shift-template-form" disabled={loading}>
            {loading && <Spinner />}
            {isEdit ? 'Kaydet' : 'Ekle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
