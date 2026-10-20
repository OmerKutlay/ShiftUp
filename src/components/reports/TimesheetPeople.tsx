'use client'

/**
 * TimesheetPeople — aylık puantajın "Kişiler" görünümü:
 * her çalışan için ayın günlerinden oluşan şerit (DayStrip) + seçilen kişinin takvim kartı.
 * Gün kodu renkleri timesheetSummary'deki STRIP_TONE / CALENDAR_TONE eşlemesinden gelir.
 */
import { ChevronRight } from 'lucide-react'
import { PersonAvatar } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { TIMESHEET_CODE_LABELS, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'
import { dayOfWeekFromDateString } from '@/lib/dateUtils'
import {
  CALENDAR_TONE, STRIP_TONE, codeCounts, hoursLabel, leaveTotal, planLabel, toneBorder,
} from './timesheetSummary'

/** Kişi satırı ve eksen başlığı aynı sütunları paylaşır: kişi · şerit · toplam */
export const PEOPLE_GRID = 'grid grid-cols-[minmax(0,11.5rem)_minmax(0,1fr)_9rem] gap-x-5'

// ─── Şerit ────────────────────────────────────────────────────

export function DayStrip({ row, days, today, size = 'md' }: {
  row: TimesheetRow; days: string[]; today: string; size?: 'sm' | 'md'
}) {
  return (
    <div aria-hidden className="flex min-w-0 gap-0.5">
      {days.map((d) => {
        const tone = STRIP_TONE[row.days[d] ?? '']
        return (
          <span
            key={d}
            className={cn(
              'min-w-0 flex-1 rounded-xs',
              size === 'md' ? 'h-6' : 'h-4',
              d === today && 'outline outline-offset-1 outline-foreground'
            )}
            style={{ backgroundColor: tone.bg, border: toneBorder(tone) }}
          />
        )
      })}
    </div>
  )
}

/** Şerit eksenindeki gün numaraları: haftalık (1, 8, 15 …) + bugün; dar ekranda 1 · bugün · son gün */
export function StripAxis({ days, today, compact }: { days: string[]; today: string; compact?: boolean }) {
  const t = days.indexOf(today)
  const base = compact ? [0, days.length - 1] : [0, 7, 14, 21, 28].filter((i) => i < days.length)
  // Bugün, yakındaki haftalık işaretin yerini alır (üst üste binmesin)
  const ticks = t < 0 ? base : [...base.filter((i) => Math.abs(i - t) > (compact ? 3 : 2)), t].sort((a, b) => a - b)
  return (
    <div aria-hidden className="relative h-4">
      {ticks.map((i) => {
        const isToday = i === t
        const isEnd = i === days.length - 1 && !isToday
        return (
          <span
            key={i}
            className={cn(
              'absolute text-xs leading-4 whitespace-nowrap tabular-nums',
              isToday ? 'font-medium text-foreground' : 'text-muted-foreground',
              !isEnd && '-translate-x-1/2'
            )}
            style={isEnd ? { right: 0 } : { left: `${((i + 0.5) / days.length) * 100}%` }}
          >
            {Number(days[i].slice(8))}
            {isToday && compact && ' · bugün'}
          </span>
        )
      })}
    </div>
  )
}

// ─── Kişi özeti ───────────────────────────────────────────────

/** Satırdaki dikkat noktaları: fazla çalışma (onay yoksa uyarı rengi), devamsızlık, izin */
function RowFlags({ row, className }: { row: TimesheetRow; className?: string }) {
  const leave = leaveTotal(row)
  const parts: React.ReactNode[] = []
  if (row.overtimeMins > 0) {
    parts.push(
      <span key="ot" className={cn('whitespace-nowrap', row.overtimeWithoutConsent && 'font-medium text-warning')}>
        +{hoursLabel(row.overtimeMins)} s fazla
      </span>
    )
    if (row.overtimeWithoutConsent) parts.push(<span key="c" className="font-medium whitespace-nowrap text-warning">onay yok</span>)
  }
  if (row.absentDays > 0) parts.push(<span key="d" className="font-medium whitespace-nowrap text-destructive">{row.absentDays} devamsız</span>)
  if (leave > 0) parts.push(<span key="l" className="whitespace-nowrap">{leave} gün izin</span>)
  if (parts.length === 0) parts.push(<span key="w" className="whitespace-nowrap">{row.workedDays} gün çalıştı</span>)
  return (
    <span className={cn('text-xs text-muted-foreground tabular-nums', className)}>
      {parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}
    </span>
  )
}

function PersonName({ row }: { row: TimesheetRow }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <PersonAvatar name={row.employee.full_name} size={32} />
      <span className="grid min-w-0">
        <span className="truncate text-sm font-medium">{row.employee.full_name}</span>
        <span className="truncate text-xs text-muted-foreground">{row.employee.role_name}</span>
      </span>
    </span>
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
        'relative w-full items-center border-t px-6 py-3 text-left transition-colors outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
        selected
          ? 'bg-muted/60 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary'
          : 'hover:bg-muted/40'
      )}
    >
      <PersonName row={row} />
      <DayStrip row={row} days={days} today={today} />
      <span className="grid min-w-0 justify-items-end text-right">
        <span className="text-sm font-semibold tabular-nums">{hoursLabel(row.workedMins)} s</span>
        <RowFlags row={row} className="text-balance" />
      </span>
    </button>
  )
}

// ─── Kişi kartı (mobil) ───────────────────────────────────────

export function PersonItem({ row, days, today, onOpen }: {
  row: TimesheetRow; days: string[]; today: string; onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${row.employee.full_name} — ${hoursLabel(row.workedMins)} saat, takvimi aç`}
      className="flex w-full flex-col gap-3 rounded-lg border bg-card p-4 text-left shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1"><PersonName row={row} /></span>
        <span className="text-sm font-semibold tabular-nums">{hoursLabel(row.workedMins)} s</span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </span>
      <span className="grid gap-1">
        <DayStrip row={row} days={days} today={today} size="sm" />
        <StripAxis days={days} today={today} compact />
      </span>
      <RowFlags row={row} />
    </button>
  )
}

// ─── Lejant ───────────────────────────────────────────────────

const LEGEND: Array<Exclude<TimesheetCode, ''>> = ['Ç', 'HT', 'Yİ', 'Rİ', 'D', 'RT', 'RTÇ', 'P']

export function LegendSwatch({ code, className }: { code: TimesheetCode; className?: string }) {
  const tone = STRIP_TONE[code]
  return (
    <span
      aria-hidden
      className={cn('size-3 shrink-0 rounded-xs', className)}
      style={{ backgroundColor: tone.bg, border: toneBorder(tone) }}
    />
  )
}

export function StripLegend({ today, codes = LEGEND }: { today: string; codes?: Array<Exclude<TimesheetCode, ''>> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {codes.map((c) => (
        <span key={c} className="flex items-center gap-1.5">
          <LegendSwatch code={c} />
          {TIMESHEET_CODE_LABELS[c]}
        </span>
      ))}
      {today && (
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-xs outline outline-offset-1 outline-foreground" />
          Bugün ({Number(today.slice(8))} {monthName(today)})
        </span>
      )}
    </div>
  )
}

const monthName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('tr-TR', { month: 'long', timeZone: 'UTC' })

// ─── Kişi detayı: ay takvimi ──────────────────────────────────

const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

export function PersonDetailCard({ row, days, today, monthText, className }: {
  row: TimesheetRow; days: string[]; today: string; monthText: string; className?: string
}) {
  const lead = (dayOfWeekFromDateString(days[0]) + 6) % 7
  const stats: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'Net', value: `${hoursLabel(row.workedMins)} s` },
    { label: 'Fazla', value: `${hoursLabel(row.overtimeMins)} s`, tone: row.overtimeMins > 0 ? 'text-warning' : undefined },
    { label: 'Gece', value: `${hoursLabel(row.nightMins)} s` },
    { label: 'SGK', value: `${row.sgkDays} gün` },
  ]

  return (
    <Card className={cn('@container/detail gap-5 shadow-xs', className)}>
      <CardHeader className="grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0 px-5 has-data-[slot=card-action]:grid-cols-[auto_1fr_auto]">
        <PersonAvatar name={row.employee.full_name} size={40} className="row-span-2" />
        <CardTitle className="truncate leading-snug">{row.employee.full_name}</CardTitle>
        <CardDescription className="col-start-2 truncate">
          {[row.employee.role_name, monthText].filter(Boolean).join(' · ')}
        </CardDescription>
        {row.overtimeWithoutConsent && (
          <CardAction className="col-start-3 row-span-2 self-center">
            <Badge tone="warning">Onay yok</Badge>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="grid gap-5 px-5">
        <dl className="grid grid-cols-4 divide-x rounded-lg border">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0 px-3 py-2">
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className={cn('truncate text-sm font-semibold tabular-nums', s.tone)}>{s.value}</dd>
            </div>
          ))}
        </dl>

        {/* Geniş kartta (alt alta düzen) takvim ve döküm yan yana */}
        <div className="grid gap-5 @2xl/detail:grid-cols-[minmax(0,1fr)_15rem] @2xl/detail:items-start @2xl/detail:gap-6">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <span key={w} aria-hidden className="pb-1 text-center text-xs text-muted-foreground">{w}</span>
            ))}
            {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} aria-hidden />)}
            {days.map((d) => <CalendarCell key={d} row={row} date={d} today={today} />)}
          </div>

          <div className="grid gap-2 border-t pt-4 @2xl/detail:border-t-0 @2xl/detail:border-l @2xl/detail:pt-0 @2xl/detail:pl-6">
            <p className="text-xs font-medium text-muted-foreground">Ay dökümü</p>
            {codeCounts(row).map(({ code, count }) => (
              <div key={code} className="flex items-center gap-2 text-sm">
                <LegendSwatch code={code} />
                <span className="flex-1">{TIMESHEET_CODE_LABELS[code]}</span>
                <span className="font-medium tabular-nums">{count} gün</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CalendarCell({ row, date, today }: { row: TimesheetRow; date: string; today: string }) {
  const code = row.days[date] ?? ''
  const tone = CALENDAR_TONE[code]
  const mins = row.dayMins?.[date]
  const plan = row.dayPlan?.[date]
  const value = mins !== undefined ? `${hoursLabel(mins)} s` : code === 'P' && plan ? planLabel(plan) : tone.label
  const label = code ? `${TIMESHEET_CODE_LABELS[code]}${value ? ` (${value})` : ''}` : undefined
  return (
    <div
      title={label}
      className={cn(
        'flex min-h-12 min-w-0 flex-col justify-between gap-1 overflow-hidden rounded-md p-1 @2xl/detail:min-h-14 @2xl/detail:p-1.5',
        date === today && 'ring-2 ring-foreground'
      )}
      style={{ backgroundColor: tone.bg, color: tone.fg, border: toneBorder(tone) ?? '1px solid transparent' }}
    >
      <span className={cn('text-xs leading-none tabular-nums', date === today ? 'font-semibold text-foreground' : 'opacity-70')}>
        {Number(date.slice(8))}
        {date === today && <span className="sr-only"> (bugün)</span>}
      </span>
      {value && <span aria-hidden={!!label} className="text-xs leading-tight font-medium tracking-tight tabular-nums">{value}</span>}
      {label && <span className="sr-only">{label}</span>}
    </div>
  )
}
