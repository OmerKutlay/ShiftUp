'use client'

// Uygulamanın temasına uygun tarih / ay seçici — tarayıcının yerel <input type="date">
// penceresi yerine Türkçe, pazartesi başlangıçlı, klavyeyle kullanılabilen takvim.
// Değerler native input'la aynı biçimde taşınır: tarih 'yyyy-MM-dd', ay 'yyyy-MM', boş = ''.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  addDays, addMonths, addYears, endOfMonth, format, isSameDay, isSameMonth, parse,
  startOfMonth, startOfWeek,
} from 'date-fns'
import { tr } from 'date-fns/locale'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

type Mode = 'date' | 'month'
type View = 'days' | 'months' | 'years'

const WEEKDAYS = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']
const FMT: Record<Mode, string> = { date: 'yyyy-MM-dd', month: 'yyyy-MM' }

function parseValue(value: string, mode: Mode): Date | null {
  if (!value) return null
  const d = parse(value, FMT[mode], new Date())
  return Number.isNaN(d.getTime()) ? null : d
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1)

/** Takvim hücresi (gün / ay / yıl) ortak görünümü */
function cellClass(opts: { selected?: boolean; today?: boolean; muted?: boolean }) {
  return cn(
    'flex items-center justify-center rounded-[10px] border border-transparent text-sm font-medium transition-colors outline-none',
    'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30',
    opts.selected
      ? 'bg-primary font-bold text-primary-foreground hover:bg-brand-dark'
      : cn('hover:bg-accent', opts.muted ? 'text-ink-muted' : 'text-ink'),
    opts.today && !opts.selected && 'border-primary/60'
  )
}

// ------------------------------------------------------------------
// Takvim paneli
// ------------------------------------------------------------------

interface CalendarProps {
  mode: Mode
  selected: Date | null
  min?: string
  max?: string
  clearable: boolean
  onPick: (d: Date) => void
  onClear: () => void
}

function Calendar({ mode, selected, min, max, clearable, onPick, onClear }: CalendarProps) {
  const today = new Date()
  const [view, setView] = useState<View>(mode === 'date' ? 'days' : 'months')
  const [viewDate, setViewDate] = useState(() => startOfMonth(selected ?? today))
  const [focused, setFocused] = useState(() => selected ?? today)
  const gridRef = useRef<HTMLDivElement>(null)
  const monthsRef = useRef<HTMLDivElement>(null)
  const yearsRef = useRef<HTMLDivElement>(null)

  // Aralık kontrolleri 'yyyy-MM-dd' metni üzerinden — sözlük sırası = tarih sırası
  const dayDisabled = (d: Date) => {
    const iso = format(d, 'yyyy-MM-dd')
    return (!!min && iso < min) || (!!max && iso > max)
  }
  const monthDisabled = (d: Date) =>
    (!!min && format(endOfMonth(d), 'yyyy-MM-dd') < min) || (!!max && format(startOfMonth(d), 'yyyy-MM-dd') > max)
  const yearDisabled = (y: number) => (!!min && y < Number(min.slice(0, 4))) || (!!max && y > Number(max.slice(0, 4)))

  const minYear = min ? Number(min.slice(0, 4)) : Math.min(1930, (selected ?? today).getFullYear())
  const maxYear = max ? Number(max.slice(0, 4)) : Math.max(today.getFullYear() + 10, (selected ?? today).getFullYear())
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)

  // Açılışta / klavyeyle gezinirken odaklanan günü DOM'da da odakla
  useEffect(() => {
    if (view !== 'days') return
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${format(focused, 'yyyy-MM-dd')}"]`)?.focus()
  }, [focused, view])

  // Ay görünümünde seçili (yoksa ilk etkin) ayı odakla
  useEffect(() => {
    if (view !== 'months') return
    const root = monthsRef.current
    ;(root?.querySelector<HTMLElement>('[aria-pressed="true"]:not(:disabled)') ?? root?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus()
  }, [view])

  // Yıl listesinde seçili yılı görünür yap
  useEffect(() => {
    if (view !== 'years') return
    const el = yearsRef.current?.querySelector<HTMLElement>(`[data-year="${viewDate.getFullYear()}"]`)
    el?.scrollIntoView?.({ block: 'center' })
    el?.focus()
  }, [view, viewDate])

  const moveFocus = (d: Date) => {
    setFocused(d)
    if (!isSameMonth(d, viewDate)) setViewDate(startOfMonth(d))
  }

  const onGridKeyDown = (e: KeyboardEvent) => {
    const step: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => addMonths(focused, -1),
      PageDown: () => addMonths(focused, 1),
      Home: () => startOfWeek(focused, { weekStartsOn: 1 }),
      End: () => addDays(startOfWeek(focused, { weekStartsOn: 1 }), 6),
    }
    if (step[e.key]) {
      e.preventDefault()
      moveFocus(step[e.key]())
    }
  }

  const shift = (dir: 1 | -1) => {
    if (view === 'days') {
      const next = addMonths(viewDate, dir)
      setViewDate(next)
      setFocused(next)
    } else {
      setViewDate(addYears(viewDate, dir))
    }
  }

  const headerLabel =
    view === 'days' ? cap(format(viewDate, 'LLLL yyyy', { locale: tr }))
      : view === 'months' ? format(viewDate, 'yyyy')
        : 'Yıl seçin'

  return (
    <div className="w-[296px] max-w-full">
      {/* Başlık: ay/yıl + gezinme okları */}
      <div className="mb-2 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="px-2 text-[0.95rem] font-bold"
          onClick={() => setView(view === 'years' ? (mode === 'date' ? 'days' : 'months') : view === 'days' ? 'months' : 'years')}
          aria-label={view === 'years' ? 'Geri dön' : 'Ay veya yıl seç'}
        >
          {headerLabel}
          {view !== 'years' && <ChevronDown className="size-4 text-ink-secondary" />}
        </Button>
        {view !== 'years' && (
          <div className="flex">
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => shift(-1)}
              aria-label={view === 'days' ? 'Önceki ay' : 'Önceki yıl'}>
              <ChevronLeft />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => shift(1)}
              aria-label={view === 'days' ? 'Sonraki ay' : 'Sonraki yıl'}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      {view === 'days' && (
        <>
          <div className="mb-1 grid grid-cols-7" aria-hidden>
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={cn('py-1 text-center text-xs font-bold', i >= 5 ? 'text-ink-muted' : 'text-ink-secondary')}>
                {w}
              </span>
            ))}
          </div>
          <div ref={gridRef} onKeyDown={onGridKeyDown} className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(viewDate, { weekStartsOn: 1 }), i)).map((d) => {
              const isSel = !!selected && isSameDay(d, selected)
              return (
                <button
                  type="button"
                  key={d.toISOString()}
                  data-day={format(d, 'yyyy-MM-dd')}
                  tabIndex={isSameDay(d, focused) ? 0 : -1}
                  disabled={dayDisabled(d)}
                  onClick={() => onPick(d)}
                  aria-label={format(d, 'd MMMM yyyy, EEEE', { locale: tr })}
                  aria-pressed={isSel}
                  className={cn('h-10', cellClass({ selected: isSel, today: isSameDay(d, today), muted: !isSameMonth(d, viewDate) }))}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </>
      )}

      {view === 'months' && (
        <div ref={monthsRef} className="grid grid-cols-3 gap-1.5 py-1">
          {Array.from({ length: 12 }, (_, m) => new Date(viewDate.getFullYear(), m, 1)).map((d) => {
            const isSel = !!selected && isSameMonth(d, selected)
            return (
              <button
                type="button"
                key={d.getMonth()}
                disabled={monthDisabled(d)}
                aria-pressed={isSel}
                onClick={() => {
                  if (mode === 'month') return onPick(d)
                  setViewDate(d)
                  setFocused(selected && isSameMonth(d, selected) ? selected : d)
                  setView('days')
                }}
                className={cn('h-11', cellClass({ selected: isSel, today: isSameMonth(d, today) }))}
              >
                {cap(format(d, 'LLL', { locale: tr }))}
              </button>
            )
          })}
        </div>
      )}

      {view === 'years' && (
        <div ref={yearsRef} className="grid max-h-62 grid-cols-4 gap-1.5 overflow-y-auto py-1 pr-1">
          {years.map((y) => {
            const isSel = !!selected && selected.getFullYear() === y
            return (
              <button
                type="button"
                key={y}
                data-year={y}
                disabled={yearDisabled(y)}
                aria-pressed={isSel}
                onClick={() => { setViewDate(new Date(y, viewDate.getMonth(), 1)); setView('months') }}
                className={cn('h-10', cellClass({ selected: isSel, today: y === today.getFullYear() }))}
              >
                {y}
              </button>
            )
          })}
        </div>
      )}

      {/* Alt çubuk */}
      <div className="mt-3 flex items-center justify-between border-t pt-2">
        {clearable ? (
          <Button type="button" variant="ghost" size="sm" className="text-ink-secondary" onClick={onClear}>Temizle</Button>
        ) : <span />}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-primary"
          onClick={() => onPick(mode === 'date' ? today : startOfMonth(today))}
          disabled={mode === 'date' ? dayDisabled(today) : monthDisabled(today)}
        >
          {mode === 'date' ? 'Bugün' : 'Bu ay'}
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// Alan (tetikleyici)
// ------------------------------------------------------------------

interface DateFieldProps {
  label: string
  /** 'yyyy-MM-dd' (tarih) veya 'yyyy-MM' (ay); boş = '' */
  value: string
  onChange: (value: string) => void
  /** Sınırlar değerle aynı biçimde değil, her zaman 'yyyy-MM-dd' */
  min?: string
  max?: string
  clearable?: boolean
  /** 'small' = h-10 (varsayılan), 'medium' = h-11 */
  size?: 'small' | 'medium'
  fullWidth?: boolean
  required?: boolean
  disabled?: boolean
  error?: boolean
  helperText?: string
  placeholder?: string
  /** Kapsayıcıya eklenecek sınıflar (genişlik, boşluk) */
  className?: string
}

function PickerField({
  mode, label, value, onChange, min, max, clearable = false, size = 'small', fullWidth, required, disabled, error,
  helperText, placeholder, className,
}: DateFieldProps & { mode: Mode }) {
  const id = useId()
  const inputId = `${id}-input`
  const helperId = `${id}-helper`
  const anchorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const selected = parseValue(value, mode)
  const display = selected
    ? cap(format(selected, mode === 'date' ? 'd MMMM yyyy, EEE' : 'LLLL yyyy', { locale: tr }))
    : ''

  const show = () => { if (!disabled) setOpen(true) }
  const close = () => setOpen(false)

  return (
    <div className={cn('flex flex-col gap-1.5', fullWidth ? 'w-full' : 'w-full sm:w-auto', className)}>
      <Label htmlFor={inputId}>
        {label}
        {required && <span aria-hidden className="-ml-1.5 text-danger">*</span>}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            ref={anchorRef}
            className={cn(
              'relative flex w-full items-center rounded-[10px] border border-input bg-card transition-[color,box-shadow]',
              'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40',
              size === 'small' ? 'h-10' : 'h-11',
              error && 'border-destructive',
              disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            )}
            onClick={() => { if (!disabled) setOpen((o) => !o) }}
          >
            <input
              ref={inputRef}
              id={inputId}
              readOnly
              value={display}
              placeholder={placeholder ?? (mode === 'date' ? 'Tarih seçin' : 'Ay seçin')}
              required={required}
              disabled={disabled}
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-invalid={error || undefined}
              aria-describedby={helperText ? helperId : undefined}
              onKeyDown={(e) => {
                if (['Enter', ' ', 'ArrowDown'].includes(e.key)) {
                  e.preventDefault()
                  show()
                }
              }}
              className="h-full min-w-0 flex-1 cursor-[inherit] bg-transparent pl-3 text-base caret-transparent outline-none placeholder:text-ink-muted md:text-sm"
            />
            <CalendarDays aria-hidden className={cn('mr-3 size-4 shrink-0', open ? 'text-primary' : 'text-ink-secondary')} />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          aria-label={label}
          className="w-auto"
          // Odak takvimdeki seçili güne gider (Calendar içindeki efekt)
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus() }}
          onInteractOutside={(e) => {
            // Alanın kendisine tıklama kapat/aç geçişini onClick'e bıraksın
            if (e.target instanceof Node && anchorRef.current?.contains(e.target)) e.preventDefault()
          }}
        >
          <Calendar
            mode={mode}
            selected={selected}
            min={min}
            max={max}
            clearable={clearable}
            onPick={(d) => { onChange(format(d, FMT[mode])); close() }}
            onClear={() => { onChange(''); close() }}
          />
        </PopoverContent>
      </Popover>
      {helperText && (
        <p id={helperId} className={cn('text-xs', error ? 'text-danger' : 'text-ink-secondary')}>{helperText}</p>
      )}
    </div>
  )
}

export function DateField(props: DateFieldProps) {
  return <PickerField mode="date" {...props} />
}

export function MonthField(props: DateFieldProps) {
  return <PickerField mode="month" {...props} />
}
