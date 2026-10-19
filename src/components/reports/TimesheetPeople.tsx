'use client'

/**
 * TimesheetPeople — aylık puantajın "Kişiler" görünümü (yeni UI):
 * her çalışan için ayın günlerinden oluşan renkli şerit + seçilen kişinin takvim detayı.
 */
import { ChevronRight } from 'lucide-react'
import { PersonAvatar } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { C } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { TIMESHEET_CODE_LABELS, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'
import { dayOfWeekFromDateString } from '@/lib/dateUtils'
import {
  CALENDAR_TONE, STRIP_TONE, codeCounts, hoursLabel, leaveTotal, planLabel,
} from './timesheetSummary'

/** Kişi satırı ve eksen başlığı aynı sütunları paylaşır */
export const PEOPLE_GRID = 'grid grid-cols-1 gap-x-4 md:grid-cols-[minmax(150px,190px)_1fr_176px]'

const boxBorder = (tone: { border?: string; dashed?: boolean }) =>
  tone.border ? `1px ${tone.dashed ? 'dashed' : 'solid'} ${tone.border}` : undefined

// ─── Şerit ────────────────────────────────────────────────────

export function DayStrip({ row, days, today, height = 18 }: {
  row: TimesheetRow; days: string[]; today: string; height?: number
}) {
  return (
    <div aria-hidden className="flex min-w-0 gap-[2px]">
      {days.map((d) => {
        const tone = STRIP_TONE[row.days[d] ?? '']
        return (
          <span
            key={d}
            className={cn('min-w-0 flex-1 rounded-[3px]', d === today && 'outline-[1.5px] outline-offset-1 outline-primary outline-solid')}
            style={{ height, backgroundColor: tone.bg, border: boxBorder(tone) }}
          />
        )
      })}
    </div>
  )
}

/** Şerit üstü/altı gün numaraları: 1, 8, 15, 22, 29 ya da (mobil) 1 · bugün · son gün */
export function StripAxis({ days, today, compact }: { days: string[]; today: string; compact?: boolean }) {
  const ticks = compact
    ? [0, days.indexOf(today), days.length - 1].filter((i, k, a) => i >= 0 && a.indexOf(i) === k)
    : [0, 7, 14, 21, 28].filter((i) => i < days.length)
  return (
    <div aria-hidden className="relative h-3.5">
      {ticks.map((i) => {
        const isToday = days[i] === today && compact
        const isEnd = i === days.length - 1
        return (
          <span
            key={i}
            className={cn(
              'absolute whitespace-nowrap text-[0.65rem] leading-[14px]',
              isToday ? 'font-bold text-primary' : 'font-medium text-ink-muted',
              !isEnd && '-translate-x-1/2'
            )}
            style={isEnd ? { right: 0 } : { left: `${((i + 0.5) / days.length) * 100}%` }}
          >
            {Number(days[i].slice(8))}
            {isToday && ' · bugün'}
          </span>
        )
      })}
    </div>
  )
}

// ─── Rozetler ─────────────────────────────────────────────────

export function RowBadges({ row, align = 'end' }: { row: TimesheetRow; align?: 'end' | 'start' }) {
  const leave = leaveTotal(row)
  if (!row.overtimeMins && !row.absentDays && !leave) return null
  return (
    <div className={cn('flex flex-wrap gap-1', align === 'end' ? 'justify-end' : 'justify-start')}>
      {row.overtimeMins > 0 && (
        <Badge tone={row.overtimeWithoutConsent ? 'warning' : 'neutral'} className="h-5 px-1.5 text-[0.68rem]">
          +{hoursLabel(row.overtimeMins)} s fazla{row.overtimeWithoutConsent ? ' · onay yok' : ''}
        </Badge>
      )}
      {row.absentDays > 0 && <Badge tone="danger" className="h-5 px-1.5 text-[0.68rem]">{row.absentDays} devamsız</Badge>}
      {leave > 0 && <Badge tone="info" className="h-5 px-1.5 text-[0.68rem]">{leave} gün izin</Badge>}
    </div>
  )
}

// ─── Kişi satırı (masaüstü) ───────────────────────────────────

export function PersonRow({ row, days, today, selected, onSelect }: {
  row: TimesheetRow; days: string[]; today: string; selected: boolean; onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${row.employee.full_name} — ${hoursLabel(row.workedMins)} saat`}
      className={cn(
        PEOPLE_GRID,
        'relative w-full items-center border-t px-4 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        selected
          ? 'bg-accent before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary'
          : 'hover:bg-muted/70'
      )}
    >
      <PersonName row={row} />
      <DayStrip row={row} days={days} today={today} />
      <div className="flex flex-col items-end gap-1 text-right">
        <span className="text-[0.9rem] font-bold">{hoursLabel(row.workedMins)} s</span>
        <RowBadges row={row} />
      </div>
    </button>
  )
}

function PersonName({ row }: { row: TimesheetRow }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar name={row.employee.full_name} size={32} />
      <div className="min-w-0">
        <p className="truncate text-[0.85rem] font-bold">{row.employee.full_name}</p>
        <p className="truncate text-xs text-ink-secondary">{row.employee.role}</p>
      </div>
    </div>
  )
}

// ─── Kişi kartı (mobil) ───────────────────────────────────────

export function PersonCard({ row, days, today, onOpen }: {
  row: TimesheetRow; days: string[]; today: string; onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${row.employee.full_name} — ${hoursLabel(row.workedMins)} saat, takvimi aç`}
      className={cn(
        'block w-full rounded-[14px] border bg-card p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        row.overtimeWithoutConsent && 'border-danger-fill'
      )}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <div className="min-w-0 flex-1"><PersonName row={row} /></div>
        <span className="text-[0.9rem] font-bold">{hoursLabel(row.workedMins)} s</span>
        <ChevronRight className="size-4 text-ink-muted" />
      </div>
      <DayStrip row={row} days={days} today={today} height={14} />
      <div className="mt-1"><StripAxis days={days} today={today} compact /></div>
      <div className="mt-1.5"><RowBadges row={row} align="start" /></div>
    </button>
  )
}

// ─── Lejant ───────────────────────────────────────────────────

const LEGEND: Array<Exclude<TimesheetCode, ''>> = ['Ç', 'HT', 'Yİ', 'Rİ', 'D', 'RT', 'RTÇ', 'P']

export function StripLegend({ today }: { today: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {LEGEND.map((c) => (
        <span key={c} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <LegendDot code={c} />
          {TIMESHEET_CODE_LABELS[c]}
        </span>
      ))}
      <span className="text-xs text-ink-secondary">
        Çerçeveli gün: bugün ({Number(today.slice(8))} {monthName(today)})
      </span>
    </div>
  )
}

function LegendDot({ code }: { code: TimesheetCode }) {
  const tone = STRIP_TONE[code]
  return <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: tone.bg, border: boxBorder(tone) }} />
}

const monthName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('tr-TR', { month: 'long', timeZone: 'UTC' })

// ─── Kişi detayı: takvim ──────────────────────────────────────

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const WEEKDAYS_SHORT = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']

export function PersonDetail({ row, days, today, monthText, compact }: {
  row: TimesheetRow; days: string[]; today: string; monthText: string; compact?: boolean
}) {
  const lead = (dayOfWeekFromDateString(days[0]) + 6) % 7
  const stats: Array<{ label: string; value: string; warn?: boolean }> = [
    { label: 'Net', value: `${hoursLabel(row.workedMins)} s` },
    { label: 'Fazla', value: `${hoursLabel(row.overtimeMins)} s`, warn: row.overtimeMins > 0 },
    { label: 'Gece', value: `${hoursLabel(row.nightMins)} s` },
    { label: 'SGK', value: `${row.sgkDays} gün` },
  ]

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <PersonAvatar name={row.employee.full_name} size={compact ? 44 : 40} />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate font-bold', compact ? 'text-lg' : 'text-base')}>{row.employee.full_name}</p>
          <p className="truncate text-[0.78rem] text-ink-secondary">{row.employee.role} · {monthText}</p>
        </div>
        {row.overtimeWithoutConsent && <Badge tone="danger">Onay yok</Badge>}
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[10px] bg-muted px-2.5 py-2">
            <p className="text-[0.7rem] text-ink-secondary">{s.label}</p>
            <p className={cn('truncate text-[0.95rem] font-bold', s.warn && 'text-warning')}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {(compact ? WEEKDAYS_SHORT : WEEKDAYS).map((w) => (
          <span key={w} className="pb-1 text-center text-[0.68rem] text-ink-secondary">{w}</span>
        ))}
        {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
        {days.map((d) => <CalendarCell key={d} row={row} date={d} today={today} compact={compact} />)}
      </div>

      <div className="mt-4 flex flex-col gap-1.5 border-t pt-3">
        {codeCounts(row).map(({ code, count }) => (
          <div key={code} className="flex items-center gap-2 text-[0.8rem]">
            <LegendDot code={code} />
            <span className="flex-1">{TIMESHEET_CODE_LABELS[code]}</span>
            <span className="font-bold">{count} gün</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CalendarCell({ row, date, today, compact }: { row: TimesheetRow; date: string; today: string; compact?: boolean }) {
  const code = row.days[date] ?? ''
  const tone = CALENDAR_TONE[code]
  const mins = row.dayMins?.[date]
  const plan = row.dayPlan?.[date]
  const value = mins !== undefined ? `${hoursLabel(mins)}${compact ? '' : ' s'}` : code === 'P' && plan ? planLabel(plan) : tone.label
  const border = tone.dashed
    ? `1px dashed ${C.sand}`
    : code === 'D' ? `1px solid ${C.dangerFill}` : code === '' ? `1px solid ${C.border}` : '1px solid transparent'
  return (
    <div
      title={code ? TIMESHEET_CODE_LABELS[code] : undefined}
      className={cn('flex min-w-0 flex-col justify-between overflow-hidden rounded-lg px-[5px] py-1', compact ? 'min-h-12' : 'min-h-11')}
      style={{
        backgroundColor: tone.bg,
        color: tone.fg,
        border,
        boxShadow: date === today ? `inset 3px 0 0 ${C.brand}` : undefined,
      }}
    >
      <span className="text-[0.65rem] font-semibold leading-tight opacity-85">{Number(date.slice(8))}</span>
      <span className={cn('font-bold leading-[1.15]', value.length > 6 ? 'text-[0.62rem]' : 'text-[0.72rem]')}>{value}</span>
    </div>
  )
}
