'use client'

/**
 * ChecklistTemplateDialog — kontrol listesi şablonu oluştur / düzenle.
 * Maddeler yukarı/aşağı düğmeleriyle sıralanır. Her açılışta yeni `key` ile mount edilir.
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, TriangleAlert } from 'lucide-react'

import type { ChecklistKind, ChecklistTemplate, ChecklistTemplateInput } from '@/types/checklist'
import { CHECKLIST_KIND_LABELS } from '@/types/checklist'
import { ALL_WEEKDAYS, MAX_ITEMS, MAX_ITEM_TEXT } from '@/lib/checklistRules'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { WEEKDAY_OPTIONS } from './format'

interface Props {
  open: boolean
  template: ChecklistTemplate | null
  loading: boolean
  onClose: () => void
  onSave: (input: ChecklistTemplateInput) => Promise<void>
}

interface DraftItem { key: number; text: string; required: boolean }

let keySeq = 0
const nextKey = () => ++keySeq

const KINDS: ChecklistKind[] = ['opening', 'closing', 'custom']

/** Dizide i. öğeyi j. konuma taşır (sınır dışıysa aynen döner) */
export function moveItem<T>(list: T[], i: number, j: number): T[] {
  if (j < 0 || j >= list.length || i === j) return list
  const next = [...list]
  const [it] = next.splice(i, 1)
  next.splice(j, 0, it)
  return next
}

export function ChecklistTemplateDialog({ open, template, loading, onClose, onSave }: Props) {
  const isEdit = !!template
  const [name, setName] = useState(template?.name ?? '')
  const [kind, setKind] = useState<ChecklistKind>(template?.kind ?? 'custom')
  const [weekdays, setWeekdays] = useState<number[]>(template?.weekdays ?? [...ALL_WEEKDAYS])
  const [dueTime, setDueTime] = useState(template?.due_time ?? '')
  const [active, setActive] = useState(template?.active ?? true)
  const [items, setItems] = useState<DraftItem[]>(
    () => template?.items.map((i) => ({ key: nextKey(), text: i.text, required: i.required })) ?? []
  )
  const [error, setError] = useState<string | null>(null)

  const toggleDay = (d: number) =>
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))
  const patchItem = (key: number, patch: Partial<DraftItem>) =>
    setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  async function submit() {
    if (loading) return
    const cleaned = items.map((i) => ({ text: i.text.trim(), required: i.required })).filter((i) => i.text)
    if (!name.trim()) return setError('Liste adı zorunludur.')
    if (weekdays.length === 0) return setError('En az bir gün seçin.')
    if (cleaned.length === 0) return setError('En az bir madde ekleyin.')
    setError(null)
    try {
      await onSave({
        name: name.trim(), kind, weekdays: [...weekdays].sort((a, b) => a - b),
        due_time: dueTime || null, active, items: cleaned,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !loading) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Listeyi düzenle' : 'Yeni kontrol listesi'}</DialogTitle>
          <DialogDescription>
            Değişiklikler bugünkü ve sonraki günlerin listelerini etkilemez; yeni günler güncel şablondan oluşur.
          </DialogDescription>
        </DialogHeader>

        <form id="checklist-template-form" noValidate onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <FieldGroup className="gap-5">
            {error && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Kaydedilemedi</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Field>
              <FieldLabel htmlFor="cl-name">Liste adı</FieldLabel>
              <Input id="cl-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Açılış, Kapanış, Haftalık temizlik…" autoFocus />
            </Field>

            <Field>
              <FieldLabel>Tür</FieldLabel>
              <div role="group" aria-label="Liste türü" className="inline-flex rounded-lg bg-muted p-[3px]">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={cn(
                      'h-9 rounded-md px-3 text-sm font-medium transition-colors',
                      kind === k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {CHECKLIST_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </Field>

            <Field>
              <FieldLabel>Günler</FieldLabel>
              <div role="group" aria-label="Günler" className="flex flex-wrap gap-1.5">
                {WEEKDAY_OPTIONS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={weekdays.includes(d.value)}
                    aria-label={d.long}
                    onClick={() => toggleDay(d.value)}
                    className={cn(
                      'h-10 min-w-12 rounded-lg border px-3 text-sm font-medium transition-colors',
                      weekdays.includes(d.value) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {d.short}
                  </button>
                ))}
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="cl-due">
                Son saat <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
              </FieldLabel>
              <Input id="cl-due" type="time" step={300} value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="w-32 tabular-nums" />
              <FieldDescription>Bu saatten 15 dakika sonra tamamlanmamışsa yöneticilere bildirim gider.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Maddeler</FieldLabel>
              <ul className="flex flex-col gap-2">
                {items.map((it, idx) => (
                  <li key={it.key} className="flex flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:items-center">
                    <Input
                      value={it.text}
                      maxLength={MAX_ITEM_TEXT}
                      onChange={(e) => patchItem(it.key, { text: e.target.value })}
                      aria-label={`Madde ${idx + 1}`}
                      className="min-w-0 flex-1"
                    />
                    <div className="flex items-center justify-between gap-1">
                      <label className="flex items-center gap-1.5 px-1 text-sm">
                        <Checkbox checked={it.required} onCheckedChange={(v) => patchItem(it.key, { required: v === true })} aria-label={`Madde ${idx + 1} zorunlu`} />
                        Zorunlu
                      </label>
                      <span className="flex">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Yukarı taşı" disabled={idx === 0} onClick={() => setItems((c) => moveItem(c, idx, idx - 1))}><ArrowUp /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Aşağı taşı" disabled={idx === items.length - 1} onClick={() => setItems((c) => moveItem(c, idx, idx + 1))}><ArrowDown /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Maddeyi sil" onClick={() => setItems((c) => c.filter((x) => x.key !== it.key))}><Trash2 /></Button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={items.length >= MAX_ITEMS}
                onClick={() => setItems((c) => [...c, { key: nextKey(), text: '', required: false }])}
              >
                <Plus /> Madde ekle
              </Button>
              <FieldError />
              <FieldDescription>Zorunlu madde yoksa tüm maddeler tamamlanınca liste biter.</FieldDescription>
            </Field>

            {isEdit && (
              <Field orientation="horizontal">
                <FieldLabel htmlFor="cl-active">Aktif liste</FieldLabel>
                <Switch id="cl-active" checked={active} onCheckedChange={setActive} />
              </Field>
            )}
          </FieldGroup>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>İptal</Button>
          <Button type="submit" form="checklist-template-form" disabled={loading}>
            {loading && <Spinner />}
            {isEdit ? 'Kaydet' : 'Ekle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
