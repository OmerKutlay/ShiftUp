'use client'

import { useState, useEffect } from 'react'
import { AlertCircle, Clock, Loader2, X } from 'lucide-react'
import type { ShiftTemplate, CreateShiftTemplatePayload, UpdateShiftTemplatePayload } from '@/types/shiftTemplate'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

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
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(template ? toFormState(template) : EMPTY_FORM)
      setErrors({})
      setSubmitError(null)
    }
  }, [open, template])

  function validate(): boolean {
    const next: typeof errors = {}
    if (!form.name.trim()) next.name = 'Şablon adı zorunludur.'
    if (!form.start_time) {
      next.start_time = 'Başlangıç saati zorunludur.'
    } else if (!isValidTime(form.start_time)) {
      next.start_time = 'Geçerli bir saat girin (ÖR: 09:00).'
    }
    if (!form.end_time) {
      next.end_time = 'Bitiş saati zorunludur.'
    } else if (!isValidTime(form.end_time)) {
      next.end_time = 'Geçerli bir saat girin (ÖR: 18:00).'
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
    if (!validate()) return
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

  // Süre hesapla (preview)
  const durationLabel = (() => {
    if (!isValidTime(form.start_time) || !isValidTime(form.end_time)) return null
    const [sh, sm] = form.start_time.split(':').map(Number)
    const [eh, em] = form.end_time.split(':').map(Number)
    let mins = (eh * 60 + em) - (sh * 60 + sm)
    if (mins <= 0) mins += 24 * 60  // gece yarısı geçen vardiyalar
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return m > 0 ? `${h} saat ${m} dakika` : `${h} saat`
  })()

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Şablonu Düzenle' : 'Yeni Vardiya Şablonu'}</DialogTitle>
          <DialogDescription>Haftalık planda tek tıkla atanacak vardiya saatleri.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {submitError && (
            <Alert tone="danger" className="pr-10 sm:col-span-2">
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

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="tpl-name">Şablon adı</Label>
            <Input
              id="tpl-name"
              placeholder="Açılış, Kapanış, Ortacı…"
              value={form.name}
              onChange={handleText('name')}
              aria-invalid={!!errors.name || undefined}
              autoFocus
            />
            {errors.name && <p className="text-xs text-danger">{errors.name}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-start">Başlangıç saati</Label>
            <Input
              id="tpl-start"
              type="time"
              step={300}
              value={form.start_time}
              onChange={handleText('start_time')}
              aria-invalid={!!errors.start_time || undefined}
            />
            {errors.start_time && <p className="text-xs text-danger">{errors.start_time}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-end">Bitiş saati</Label>
            <Input
              id="tpl-end"
              type="time"
              step={300}
              value={form.end_time}
              onChange={handleText('end_time')}
              aria-invalid={!!errors.end_time || undefined}
            />
            {errors.end_time && <p className="text-xs text-danger">{errors.end_time}</p>}
          </div>

          {durationLabel && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-primary sm:col-span-2">
              <Clock aria-hidden className="size-3.5" />
              {durationLabel}
            </p>
          )}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="tpl-desc">Açıklama (opsiyonel)</Label>
            <Textarea
              id="tpl-desc"
              rows={2}
              className="min-h-16"
              value={form.description}
              onChange={handleText('description')}
            />
          </div>

          {isEdit && (
            <div className="flex items-center gap-3 sm:col-span-2">
              <Switch
                id="tpl-active"
                checked={form.active}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, active: checked }))}
                className="data-[state=checked]:bg-success"
              />
              <Label htmlFor="tpl-active">{form.active ? 'Aktif' : 'Pasif'}</Label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>İptal</Button>
          <Button type="button" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />}
            {isEdit ? 'Kaydet' : 'Ekle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
