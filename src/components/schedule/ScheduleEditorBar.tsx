'use client'

/**
 * ScheduleEditorBar — haftalık plan editör modunun taş paleti.
 *
 * Taşlar: aktif vardiya şablonları + yöneticinin eklediği özel saatli taşlar, "Tatil" ve "Sil".
 * Seçili taş, tabloda tıklanan her hücreye uygulanır. Sağda bekleyen değişiklik sayısı,
 * "Vazgeç" ve "Kaydet". Masaüstünde tablonun üstünde kart; mobilde alt gezinmeye yapışık sabit çubuk.
 */
import { useState } from 'react'
import { Armchair, Eraser, Plus, Trash2 } from 'lucide-react'
import { BOTTOM_NAV_HEIGHT } from '@/components/layout/MobileBottomNav'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import type { ShiftStone } from './scheduleEditor'
import { fmtRange, shiftKindOf } from './scheduleHelpers'
import { ShiftKindBar } from './ScheduleCells'

interface Props {
  /** Şablon + özel vardiya taşları */
  stones: ShiftStone[]
  /** Silinebilir (yöneticinin eklediği) taşların id'leri */
  customIds: ReadonlySet<string>
  selectedId: string
  onSelect: (id: string) => void
  onAddCustom: (label: string, start: string, end: string) => void
  onRemoveCustom: (id: string) => void
  pendingCount: number
  saving: boolean
  /** Kayıt ilerlemesi (hücre) */
  progress: { done: number; total: number } | null
  onCancel: () => void
  onSave: () => void
  /** Mobil: alt gezinmenin üstünde sabit çubuk */
  compact?: boolean
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const stoneItem = cn(
  'h-9 gap-1.5 px-2.5 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground',
)

/** Özel saatli taş ekleme formu + eklenen taşların listesi */
function AddStonePopover({ stones, customIds, onAdd, onRemove, side }: {
  stones: ShiftStone[]
  customIds: ReadonlySet<string>
  onAdd: Props['onAddCustom']
  onRemove: Props['onRemoveCustom']
  side: 'top' | 'bottom'
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [start, setStart] = useState('10:00')
  const [end, setEnd] = useState('19:00')
  const [error, setError] = useState<string | null>(null)
  const custom = stones.filter((s) => customIds.has(s.id))

  const add = () => {
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) { setError('Geçerli saatler girin (SS:DD).'); return }
    if (start === end) { setError('Başlangıç ve bitiş saati aynı olamaz.'); return }
    onAdd(label.trim() || 'Özel', start, end)
    setLabel('')
    setError(null)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="shrink-0">
          <Plus />
          Taş ekle
        </Button>
      </PopoverTrigger>
      <PopoverContent side={side} align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>Özel taş</PopoverTitle>
          <PopoverDescription>Şablonda olmayan saatler için. Bu cihazda saklanır.</PopoverDescription>
        </PopoverHeader>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); add() }}
        >
          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field className="col-span-2">
              <FieldLabel htmlFor="stone-label">Ad</FieldLabel>
              <Input
                id="stone-label" value={label} maxLength={20} placeholder="Özel"
                className="text-base md:text-sm" onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="stone-start">Başlangıç</FieldLabel>
              <Input id="stone-start" type="time" step={300} value={start} className="text-base md:text-sm" onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="stone-end">Bitiş</FieldLabel>
              <Input id="stone-end" type="time" step={300} value={end} className="text-base md:text-sm" onChange={(e) => setEnd(e.target.value)} />
            </Field>
            {error && <FieldError className="col-span-2">{error}</FieldError>}
          </FieldGroup>
          <Button type="submit" size="sm">Ekle</Button>
        </form>
        {custom.length > 0 && (
          <>
            <Separator className="my-3" />
            <ul className="flex flex-col gap-1" aria-label="Eklenen taşlar">
              {custom.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <ShiftKindBar kind={shiftKindOf(s.label, s.start, s.end)} className="h-4" />
                  <span className="truncate">{s.label}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{fmtRange(s.start, s.end)}</span>
                  <Button
                    variant="ghost" size="icon" className="ml-auto size-7"
                    aria-label={`${s.label} taşını kaldır`} onClick={() => onRemove(s.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function ScheduleEditorBar({
  stones, customIds, selectedId, onSelect, onAddCustom, onRemoveCustom,
  pendingCount, saving, progress, onCancel, onSave, compact,
}: Props) {
  const palette = (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={1.5}
      value={selectedId}
      // Seçili taşa tekrar basmak seçimi kaldırmasın
      onValueChange={(v) => { if (v) onSelect(v) }}
      aria-label="Taş paleti"
      className={cn(compact ? 'flex-nowrap' : 'flex-wrap')}
    >
      {stones.map((s) => (
        <ToggleGroupItem key={s.id} value={s.id} aria-label={`${s.label} ${fmtRange(s.start, s.end)}`} className={stoneItem}>
          <ShiftKindBar kind={shiftKindOf(s.label, s.start, s.end)} className="h-4" />
          {s.label}
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {compact ? s.start.slice(0, 2) : fmtRange(s.start, s.end)}
          </span>
        </ToggleGroupItem>
      ))}
      <ToggleGroupItem value="rest" aria-label="Tatil" className={stoneItem}>
        <Armchair />
        Tatil
      </ToggleGroupItem>
      <ToggleGroupItem value="erase" aria-label="Sil" className={stoneItem}>
        <Eraser />
        Sil
      </ToggleGroupItem>
    </ToggleGroup>
  )

  const addStone = (
    <AddStonePopover
      stones={stones} customIds={customIds} onAdd={onAddCustom} onRemove={onRemoveCustom}
      side={compact ? 'top' : 'bottom'}
    />
  )

  const status = (
    <span aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
      {progress
        ? `Kaydediliyor ${progress.done}/${progress.total}`
        : pendingCount > 0 ? `${pendingCount} değişiklik` : 'Değişiklik yok'}
    </span>
  )

  const actions = (
    <>
      <Button variant="outline" onClick={onCancel} disabled={saving}>Vazgeç</Button>
      <Button onClick={onSave} disabled={saving}>
        {saving && <Spinner />}
        Kaydet
      </Button>
    </>
  )

  if (compact) {
    return (
      <div
        role="toolbar"
        aria-label="Plan editörü"
        className="fixed inset-x-0 z-40 flex flex-col gap-2 border-t bg-background px-4 pt-2 pb-2"
        style={{ bottom: `calc(${BOTTOM_NAV_HEIGHT}px + var(--safe-bottom))` }}
      >
        <div data-no-pull-refresh className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-0.5">
          {palette}
          {addStone}
        </div>
        <div className="flex items-center gap-2">
          <span className="flex-1">{status}</span>
          {actions}
        </div>
      </div>
    )
  }

  return (
    <Card role="toolbar" aria-label="Plan editörü" className="flex-row items-start gap-2 p-2 shadow-xs">
      {/* Taşlar sığmazsa kendi içinde alt satıra geçer; eylemler sağda kalır */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {palette}
        {addStone}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {status}
        {actions}
      </div>
    </Card>
  )
}

/** Mobilde sabit editör çubuğunun kapladığı yükseklik (içerik alt boşluğu) */
export const EDITOR_BAR_COMPACT_HEIGHT = 104
