'use client'

// Uygulamanın temasına uygun tarih / ay seçici — tarayıcının yerel <input type="date">
// penceresi yerine Türkçe, pazartesi başlangıçlı, klavyeyle kullanılabilen takvim.
// Değerler native input'la aynı biçimde taşınır: tarih 'yyyy-MM-dd', ay 'yyyy-MM', boş = ''.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Box, Button, ButtonBase, IconButton, InputAdornment, Popover, TextField, Typography } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { alpha } from '@mui/material/styles'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import {
  addDays, addMonths, addYears, endOfMonth, format, isSameDay, isSameMonth, parse,
  startOfMonth, startOfWeek,
} from 'date-fns'
import { tr } from 'date-fns/locale'
import { C, tint } from '@/lib/palette'

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

  // Yıl listesinde seçili yılı görünür yap
  useEffect(() => {
    if (view !== 'years') return
    const el = yearsRef.current?.querySelector<HTMLElement>(`[data-year="${viewDate.getFullYear()}"]`)
    el?.scrollIntoView({ block: 'center' })
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

  const cellSx = (opts: { selected?: boolean; today?: boolean; muted?: boolean; disabled?: boolean }): SxProps<Theme> => (t) => ({
    borderRadius: 2,
    fontSize: '0.85rem',
    fontWeight: opts.selected ? 700 : 500,
    color: opts.selected ? t.palette.background.default : opts.muted ? 'text.disabled' : 'text.primary',
    bgcolor: opts.selected ? 'primary.main' : 'transparent',
    border: '1px solid',
    borderColor: opts.today && !opts.selected ? alpha(t.palette.primary.main, 0.6) : 'transparent',
    opacity: opts.disabled ? 0.3 : 1,
    transition: 'background-color 120ms',
    '&:hover': { bgcolor: opts.selected ? 'primary.light' : alpha(t.palette.primary.main, 0.12) },
    '&.Mui-focusVisible': { outline: `2px solid ${t.palette.primary.light}`, outlineOffset: 1 },
  })

  return (
    <Box sx={{ width: 296, p: 1.5 }}>
      {/* Başlık: ay/yıl + gezinme okları */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Button
          size="small"
          color="inherit"
          endIcon={view !== 'years' ? <ArrowDropDownIcon /> : undefined}
          onClick={() => setView(view === 'years' ? (mode === 'date' ? 'days' : 'months') : view === 'days' ? 'months' : 'years')}
          sx={{ fontWeight: 700, fontSize: '0.95rem', px: 1 }}
          aria-label={view === 'years' ? 'Geri dön' : 'Ay veya yıl seç'}
        >
          {headerLabel}
        </Button>
        {view !== 'years' && (
          <Box>
            <IconButton size="small" onClick={() => shift(-1)} aria-label={view === 'days' ? 'Önceki ay' : 'Önceki yıl'}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => shift(1)} aria-label={view === 'days' ? 'Sonraki ay' : 'Sonraki yıl'}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Box>
        )}
      </Box>

      {view === 'days' && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 0.5 }}>
            {WEEKDAYS.map((w, i) => (
              <Typography key={w} variant="caption" align="center"
                sx={{ fontWeight: 700, color: i >= 5 ? 'text.disabled' : 'text.secondary', py: 0.5 }}>
                {w}
              </Typography>
            ))}
          </Box>
          <Box ref={gridRef} onKeyDown={onGridKeyDown}
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.25 }}>
            {Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(viewDate, { weekStartsOn: 1 }), i)).map((d) => {
              const disabled = dayDisabled(d)
              const isSel = !!selected && isSameDay(d, selected)
              return (
                <ButtonBase
                  key={d.toISOString()}
                  data-day={format(d, 'yyyy-MM-dd')}
                  tabIndex={isSameDay(d, focused) ? 0 : -1}
                  disabled={disabled}
                  onClick={() => onPick(d)}
                  aria-label={format(d, 'd MMMM yyyy, EEEE', { locale: tr })}
                  aria-pressed={isSel}
                  sx={[{ height: 36 }, cellSx({ selected: isSel, today: isSameDay(d, today), muted: !isSameMonth(d, viewDate), disabled })] as SxProps<Theme>}
                >
                  {d.getDate()}
                </ButtonBase>
              )
            })}
          </Box>
        </>
      )}

      {view === 'months' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75, py: 0.5 }}>
          {Array.from({ length: 12 }, (_, m) => new Date(viewDate.getFullYear(), m, 1)).map((d) => {
            const disabled = monthDisabled(d)
            const isSel = !!selected && isSameMonth(d, selected)
            return (
              <ButtonBase
                key={d.getMonth()}
                disabled={disabled}
                aria-pressed={isSel}
                onClick={() => {
                  if (mode === 'month') return onPick(d)
                  setViewDate(d)
                  setFocused(selected && isSameMonth(d, selected) ? selected : d)
                  setView('days')
                }}
                sx={[{ height: 44 }, cellSx({ selected: isSel, today: isSameMonth(d, today), disabled })] as SxProps<Theme>}
              >
                {cap(format(d, 'LLL', { locale: tr }))}
              </ButtonBase>
            )
          })}
        </Box>
      )}

      {view === 'years' && (
        <Box ref={yearsRef}
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.75, maxHeight: 248, overflowY: 'auto', py: 0.5, pr: 0.5 }}>
          {years.map((y) => {
            const isSel = !!selected && selected.getFullYear() === y
            return (
              <ButtonBase
                key={y}
                data-year={y}
                disabled={yearDisabled(y)}
                aria-pressed={isSel}
                onClick={() => { setViewDate(new Date(y, viewDate.getMonth(), 1)); setView('months') }}
                sx={[{ height: 40 }, cellSx({ selected: isSel, today: y === today.getFullYear(), disabled: yearDisabled(y) })] as SxProps<Theme>}
              >
                {y}
              </ButtonBase>
            )
          })}
        </Box>
      )}

      {/* Alt çubuk */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        {clearable ? (
          <Button size="small" color="inherit" onClick={onClear} sx={{ color: 'text.secondary' }}>Temizle</Button>
        ) : <span />}
        <Button
          size="small"
          onClick={() => onPick(mode === 'date' ? today : startOfMonth(today))}
          disabled={mode === 'date' ? dayDisabled(today) : monthDisabled(today)}
        >
          {mode === 'date' ? 'Bugün' : 'Bu ay'}
        </Button>
      </Box>
    </Box>
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
  size?: 'small' | 'medium'
  fullWidth?: boolean
  required?: boolean
  disabled?: boolean
  error?: boolean
  helperText?: string
  placeholder?: string
  sx?: SxProps<Theme>
}

function PickerField({ mode, label, value, onChange, min, max, clearable = false, size, fullWidth, required, disabled, error, helperText, placeholder, sx }: DateFieldProps & { mode: Mode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const selected = parseValue(value, mode)
  const display = selected
    ? cap(format(selected, mode === 'date' ? 'd MMMM yyyy, EEE' : 'LLLL yyyy', { locale: tr }))
    : ''

  const open = (el: HTMLElement) => { if (!disabled) setAnchor(el) }
  const close = () => setAnchor(null)

  return (
    <>
      <TextField
        label={label}
        value={display}
        placeholder={placeholder ?? (mode === 'date' ? 'Tarih seçin' : 'Ay seçin')}
        size={size}
        fullWidth={fullWidth}
        required={required}
        disabled={disabled}
        error={error}
        helperText={helperText}
        sx={sx}
        onClick={(e) => open(e.currentTarget)}
        onKeyDown={(e) => {
          if (['Enter', ' ', 'ArrowDown'].includes(e.key)) {
            e.preventDefault()
            open(e.currentTarget)
          }
        }}
        slotProps={{
          inputLabel: { shrink: true },
          htmlInput: { readOnly: true, 'aria-haspopup': 'dialog', style: { cursor: 'pointer', caretColor: 'transparent' } },
          input: {
            sx: { cursor: 'pointer' },
            endAdornment: (
              <InputAdornment position="end">
                <CalendarMonthIcon fontSize="small" sx={{ color: anchor ? 'primary.main' : 'text.secondary' }} />
              </InputAdornment>
            ),
          },
        }}
      />
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': label,
            sx: { mt: 0.75, border: '1px solid', borderColor: 'divider', boxShadow: `0 12px 32px ${tint(C.ink, 0.14)}` },
          },
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
      </Popover>
    </>
  )
}

export function DateField(props: DateFieldProps) {
  return <PickerField mode="date" {...props} />
}

export function MonthField(props: DateFieldProps) {
  return <PickerField mode="month" {...props} />
}
