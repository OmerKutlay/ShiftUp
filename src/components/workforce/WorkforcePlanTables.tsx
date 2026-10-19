'use client'
/**
 * WorkforcePlanTables — İş Gücü > Haftalık Plan ekranının "Mevcut Plan" ve "Taslak" tabloları.
 *
 * 7 gün sütunu dar ekrana sıkıştırılınca hücre içerikleri komşu hücrelere taşıyordu; burada her
 * sütunun en az bir genişliği var, sığmazsa tablo yatay kayar ve çalışan sütunu sabit kalır.
 * Hücreler haftalık plan tablosundaki gibi vardiya türü renkli kutular: saat + net süre;
 * ayrıntı ipucunda.
 */
import type { CSSProperties, ReactNode } from 'react'
import { Plane, TriangleAlert } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWeekSummary, DaySummary, WorkingTimeViolation } from '@/lib/workingTimeService'
import { shiftDurationMins, netWorkMins } from '@/lib/workingTimeService'
import type { PlannerResult, DraftAssignment, ShiftKind } from '@/lib/workforcePlanner'
import { kindFromTimes } from '@/lib/workforcePlanner'
import { PART_TIME_RULES } from '@/types/employee'
import { C, SHIFT_KIND_TONES } from '@/lib/palette'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// ─── Ölçüler ──────────────────────────────────────────────────

const NAME_W = 132
const DAY_W = 100
const TOTAL_W = 70
const LAST_W = 56
const TABLE_MIN_W = NAME_W + 7 * DAY_W + TOTAL_W + LAST_W

// ─── Yardımcılar ──────────────────────────────────────────────

export function formatMins(mins: number): string {
  if (mins === 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}s` : `${h}s ${m}dk`
}

const hhmm = (t: string) => t.slice(0, 5)

export const SHIFT_KIND_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(SHIFT_KIND_TONES).map(([kind, tone]) => [kind, tone.text]),
)

const SHIFT_KIND_LABELS: Record<string, string> = {
  opening: 'Açılış',
  closing: 'Kapanış',
  full: 'Full',
  mid: 'Ortacı',
  custom: 'Özel',
}

const toneOf = (kind: string) => SHIFT_KIND_TONES[kind as ShiftKind] ?? SHIFT_KIND_TONES.custom

/** Satır vurgusu: sabit sütun yarı saydam olamaz (altından kayan hücreler görünür) → karta karıştırılmış opak ton */
type RowTone = 'danger' | 'warning' | null
const ROW_BG: Record<NonNullable<RowTone>, string> = {
  danger: 'bg-[color-mix(in_srgb,var(--danger-soft)_45%,var(--card))]',
  warning: 'bg-[color-mix(in_srgb,var(--warning-soft)_45%,var(--card))]',
}

const stickyCls = 'sticky left-0 z-[1] border-r bg-card'

/** İpucu taşıyan, klavyeyle de odaklanabilen hücre içeriği */
function Tip({ content, children, className, style }: {
  content: ReactNode; children: ReactNode; className?: string; style?: CSSProperties
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} style={style} className={cn('cursor-default rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50', className)}>
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">{content}</TooltipContent>
    </Tooltip>
  )
}

function TableFrame({ weekDays, totalLabel, lastLabel, children }: {
  weekDays: string[]; totalLabel: string; lastLabel: ReactNode; children: ReactNode
}) {
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <Table className="table-fixed" style={{ minWidth: TABLE_MIN_W }}>
        <colgroup>
          <col style={{ width: NAME_W }} />
          {weekDays.map((d) => <col key={d} style={{ minWidth: DAY_W }} />)}
          <col style={{ width: TOTAL_W }} />
          <col style={{ width: LAST_W }} />
        </colgroup>
        <TableHeader>
          <TableRow className="bg-surface-alt hover:bg-surface-alt">
            <TableHead className={cn(stickyCls, 'z-[2] bg-surface-alt')}>Çalışan</TableHead>
            {weekDays.map((d) => {
              const isToday = d === todayStr
              const date = new Date(`${d}T00:00:00`)
              return (
                <TableHead key={d} className={cn('h-auto px-1 py-2 text-center leading-tight', isToday && 'bg-brand-soft text-primary')}>
                  <span className="block">
                    {format(date, 'EEE', { locale: tr }).replace(/^./, (c) => c.toLocaleUpperCase('tr-TR'))}
                  </span>
                  <span className="block text-[0.68rem] font-medium opacity-80">
                    {format(date, 'd MMM', { locale: tr })}
                  </span>
                </TableHead>
              )
            })}
            <TableHead className="px-1 text-center">{totalLabel}</TableHead>
            <TableHead className="px-1 text-center">{lastLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  )
}

function EmploymentBadge({ type }: { type: 'full_time' | 'part_time' }) {
  const pt = type === 'part_time'
  return (
    <Badge tone={pt ? 'plum' : 'brand'} className="h-[18px] px-1.5 text-[0.62rem]">
      {pt ? 'Yarı zamanlı' : 'Tam zamanlı'}
    </Badge>
  )
}

function NameCell({ name, sub, rowTone }: { name: string; sub: ReactNode; rowTone: RowTone }) {
  return (
    <TableCell className={cn(stickyCls, rowTone && ROW_BG[rowTone], 'whitespace-normal')}>
      <p className="truncate text-[0.82rem] font-bold" title={name}>{name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">{sub}</div>
    </TableCell>
  )
}

/** Vardiya kutusu: tür rengi zeminli; saat aralığı + alt satır. Taşmaz; ayrıntı ipucunda. */
function ShiftBox({ kind, lines, sub, tooltip }: {
  kind: string; lines: { start: string; end: string }[]; sub: string; tooltip: ReactNode
}) {
  const tone = toneOf(kind)
  return (
    <Tip
      content={tooltip}
      className="flex min-h-[46px] min-w-0 flex-col justify-center px-2 py-1.5 text-left"
      style={{ backgroundColor: tone.soft, color: tone.text }}
    >
      {lines.map((s, i) => (
        <span key={i} className="block truncate text-[0.74rem] font-bold tabular-nums tracking-tight">{s.start}–{s.end}</span>
      ))}
      <span className="block truncate text-[0.66rem] font-medium opacity-85">{sub}</span>
    </Tip>
  )
}

const Dash = () => <span className="text-sm text-ink-muted">—</span>

// ─── Mevcut plan ──────────────────────────────────────────────

function CurrentDayCell({ day }: { day: DaySummary | undefined }) {
  if (!day) return <Dash />
  if (day.isLeave) {
    return (
      <div className="flex min-h-[46px] items-center gap-1.5 rounded-[10px] bg-success-soft px-2 text-success">
        <Plane className="size-3.5 shrink-0" />
        <span className="text-xs font-semibold">İzinli</span>
      </div>
    )
  }
  if (day.shifts.length === 0) return <Dash />
  const gross = day.shifts.reduce((s, x) => s + shiftDurationMins(x.start_time, x.end_time), 0)
  const first = day.shifts[0]
  const kind = kindFromTimes(hhmm(first.start_time), hhmm(first.end_time))
  return (
    <ShiftBox
      kind={kind}
      lines={day.shifts.map((s) => ({ start: hhmm(s.start_time), end: hhmm(s.end_time) }))}
      sub={`${formatMins(day.totalMins)} net`}
      tooltip={`Brüt ${formatMins(gross)} · Mola ${formatMins(gross - day.totalMins)} · Net ${formatMins(day.totalMins)}`}
    />
  )
}

function ViolationBadge({ violations }: { violations: WorkingTimeViolation[] }) {
  if (violations.length === 0) return <Dash />
  const isError = violations.some((v) => v.severity === 'error')
  return (
    <Tip content={violations.map((v) => `• ${v.message}`).join('\n')} className="inline-flex">
      <span className={cn('inline-flex items-center gap-1 text-[0.8rem] font-bold', isError ? 'text-danger' : 'text-warning')}>
        <TriangleAlert className="size-4" aria-label="İhlal" />
        {violations.length}
      </span>
    </Tip>
  )
}

export function CurrentPlanTable({ weekDays, summaries, maxWeeklyWorkHours }: {
  weekDays: string[]; summaries: EmployeeWeekSummary[]; maxWeeklyWorkHours: number
}) {
  return (
    <TableFrame weekDays={weekDays} totalLabel="Toplam" lastLabel="İhlal">
      {summaries.map((s) => {
        const hasError = s.violations.some((v) => v.severity === 'error')
        const hasWarn = s.violations.some((v) => v.severity === 'warning')
        const rowTone: RowTone = hasError ? 'danger' : hasWarn ? 'warning' : null
        const maxH = s.employment_type === 'part_time' ? PART_TIME_RULES.maxWeeklyHours : maxWeeklyWorkHours
        const isOver = s.totalWeeklyMins > maxH * 60
        return (
          <TableRow key={s.employeeId} className={cn('hover:bg-transparent', rowTone && ROW_BG[rowTone])}>
            <NameCell name={s.employeeName} rowTone={rowTone} sub={<>
              <EmploymentBadge type={s.employment_type} />
              {s.employment_type === 'part_time' && (
                <span className={cn('text-[0.66rem]', s.weeklyWorkDays > PART_TIME_RULES.maxWeeklyDays ? 'text-danger' : 'text-ink-secondary')}>
                  {s.weeklyWorkDays}/{PART_TIME_RULES.maxWeeklyDays} gün
                </span>
              )}
            </>} />
            {weekDays.map((d) => (
              <TableCell key={d} className="px-0.5 py-1.5 text-center whitespace-normal"><CurrentDayCell day={s.days[d]} /></TableCell>
            ))}
            <TableCell className="px-1 text-center">
              <p className={cn('text-[0.82rem] font-bold', isOver ? 'text-danger' : s.totalWeeklyMins > 0 ? 'text-ink' : 'text-ink-muted')}>
                {formatMins(s.totalWeeklyMins)}
              </p>
              <p className="text-[0.64rem] text-ink-secondary">/ {maxH}s</p>
            </TableCell>
            <TableCell className="px-1 text-center"><ViolationBadge violations={s.violations} /></TableCell>
          </TableRow>
        )
      })}
      {summaries.length === 0 && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={weekDays.length + 3} className="py-8 text-center text-sm text-ink-secondary">
            Bu hafta için vardiya planı bulunamadı.
          </TableCell>
        </TableRow>
      )}
    </TableFrame>
  )
}

// ─── Taslak ───────────────────────────────────────────────────

function DraftDayCell({ assign }: { assign: DraftAssignment | undefined }) {
  if (!assign) return <Dash />
  const gross = shiftDurationMins(assign.start_time, assign.end_time)
  const net = netWorkMins(assign.start_time, assign.end_time)
  const label = SHIFT_KIND_LABELS[assign.shift_kind] ?? 'Vardiya'
  return (
    <ShiftBox
      kind={assign.shift_kind}
      lines={[{ start: hhmm(assign.start_time), end: hhmm(assign.end_time) }]}
      sub={`${label} · ${formatMins(net)}`}
      tooltip={[
        `Brüt ${formatMins(gross)} · Mola ${formatMins(gross - net)} · Net ${formatMins(net)}`,
        assign.reason ?? '',
      ].filter(Boolean).join('\n')}
    />
  )
}

export function DraftPlanTable({ draft, weekDays }: { draft: PlannerResult; weekDays: string[] }) {
  const stats = Object.values(draft.stats).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'tr'))
  return (
    <TableFrame
      weekDays={weekDays}
      totalLabel="Toplam"
      lastLabel={<Tip content="Açılış / Kapanış vardiyası sayısı" className="inline-block">A / K</Tip>}
    >
      {stats.map((stat) => {
        const byDate: Record<string, DraftAssignment> = {}
        for (const a of stat.assignments) byDate[a.work_date] = a
        const targetH = stat.employment_type === 'part_time' ? PART_TIME_RULES.maxWeeklyHours : 45
        const pct = Math.min(100, Math.round((stat.totalMins / (targetH * 60)) * 100))
        const color = pct >= 95 ? C.success : pct >= 80 ? C.brand : pct >= 60 ? C.warning : C.inkMuted
        return (
          <TableRow key={stat.employeeId} className="hover:bg-transparent">
            <NameCell name={stat.employeeName} rowTone={null} sub={<>
              <EmploymentBadge type={stat.employment_type} />
              <span className="text-[0.66rem] text-ink-secondary">{stat.workDays} gün</span>
            </>} />
            {weekDays.map((d) => (
              <TableCell key={d} className="px-0.5 py-1.5 text-center whitespace-normal"><DraftDayCell assign={byDate[d]} /></TableCell>
            ))}
            <TableCell className="px-1 text-center">
              <Tip content={`Hedef: ${targetH}s`}>
                <p className="text-[0.82rem] font-bold" style={{ color }}>{formatMins(stat.totalMins)}</p>
                <p className="text-[0.64rem] text-ink-secondary">%{pct}</p>
              </Tip>
            </TableCell>
            <TableCell className="px-1 text-center">
              <Tip content={`Açılış: ${stat.openingCount} · Kapanış: ${stat.closingCount} · Full: ${stat.fullCount}`} className="inline-block">
                <span className="text-[0.78rem] font-bold">
                  <span style={{ color: SHIFT_KIND_COLORS.opening }}>{stat.openingCount}</span>
                  <span className="text-ink-muted"> / </span>
                  <span style={{ color: SHIFT_KIND_COLORS.closing }}>{stat.closingCount}</span>
                </span>
              </Tip>
            </TableCell>
          </TableRow>
        )
      })}
    </TableFrame>
  )
}
