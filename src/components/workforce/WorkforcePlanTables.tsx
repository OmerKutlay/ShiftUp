'use client'
/**
 * WorkforcePlanTables — İş gücü › Haftalık plan ekranının "Mevcut plan" ve "Taslak" tabloları.
 *
 * Kart içinde kenarsız tablo: çalışan sütunu sabit, 7 gün sütunu en az bir genişlikte; sığmazsa
 * tablo yatay kayar. Hücreler vardiya türü renk çubuğu + saat + kısa alt satır; ayrıntı ipucunda.
 */
import type { ReactNode } from 'react'
import { Lock, TriangleAlert } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeWeekSummary, DaySummary, WorkingTimeViolation } from '@/lib/workingTimeService'
import { shiftDurationMins, netWorkMins } from '@/lib/workingTimeService'
import type { PlannerResult, DraftAssignment, ShiftKind } from '@/lib/workforcePlanner'
import { PART_TIME_RULES } from '@/types/employee'
import { PersonAvatar } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'
import { KindBar, SHIFT_KIND_LABELS, fmtDuration, hhmm, kindOf, toneOf } from './workforceShared'

// ─── Ölçüler ──────────────────────────────────────────────────

const NAME_W = 208
/** Telefonda çalışan sütunu daralır (avatar gizli) — günlere yer kalsın */
const NAME_W_MOBILE = 140
const DAY_W = 104
const TOTAL_W = 92
const LAST_W = 72

const stickyCls = 'sticky left-0 z-10 border-r bg-card'
const Dash = () => <span className="text-muted-foreground/40">—</span>

// ─── Ortak parçalar ───────────────────────────────────────────

/** İpucu taşıyan, klavyeyle de odaklanabilen hücre içeriği */
function Tip({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className={cn('cursor-default rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', className)}>
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 whitespace-pre-line">{content}</TooltipContent>
    </Tooltip>
  )
}

function TableFrame({ weekDays, totalLabel, lastLabel, children }: {
  weekDays: string[]; totalLabel: string; lastLabel: ReactNode; children: ReactNode
}) {
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const nameW = useIsMobile() ? NAME_W_MOBILE : NAME_W
  return (
    <Table className="table-fixed" style={{ minWidth: nameW + weekDays.length * DAY_W + TOTAL_W + LAST_W }}>
      <colgroup>
        <col style={{ width: nameW }} />
        {weekDays.map((d) => <col key={d} style={{ minWidth: DAY_W }} />)}
        <col style={{ width: TOTAL_W }} />
        <col style={{ width: LAST_W }} />
      </colgroup>
      <TableHeader className="bg-muted">
        <TableRow className="hover:bg-transparent">
          <TableHead className={cn(stickyCls, 'z-20 bg-muted pl-4')}>Çalışan</TableHead>
          {weekDays.map((d) => {
            const isToday = d === todayStr
            const date = new Date(`${d}T12:00:00`)
            return (
              <TableHead key={d} className={cn('h-auto px-2 py-2 leading-tight', isToday && 'text-primary')}>
                <span className="block">
                  {format(date, 'EEE', { locale: tr })}
                  {isToday && <span className="sr-only"> (bugün)</span>}
                </span>
                <span className={cn('block text-xs font-normal', isToday ? 'text-primary' : 'text-muted-foreground')}>
                  {format(date, 'd MMM', { locale: tr })}
                </span>
              </TableHead>
            )
          })}
          <TableHead className="px-2 text-right">{totalLabel}</TableHead>
          <TableHead className="pr-4 pl-2 text-right">{lastLabel}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>{children}</TableBody>
    </Table>
  )
}

function NameCell({ name, sub }: { name: string; sub: ReactNode }) {
  return (
    <TableCell className={cn(stickyCls, 'py-2 pl-4')}>
      <div className="flex min-w-0 items-center gap-2.5">
        <PersonAvatar name={name} size={28} className="max-md:hidden" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium" title={name}>{name}</span>
          <span className="truncate text-xs text-muted-foreground">{sub}</span>
        </div>
      </div>
    </TableCell>
  )
}

const employmentLabel = (type: 'full_time' | 'part_time') => (type === 'part_time' ? 'Yarı zamanlı' : 'Tam zamanlı')

/** Vardiya hücresi: tür renk çubuğu + saat aralığı + alt satır. Taşmaz; ayrıntı ipucunda. */
function ShiftCell({ kind, lines, sub, tooltip, locked }: {
  kind: ShiftKind; lines: { start: string; end: string }[]; sub: string; tooltip: ReactNode; locked?: boolean
}) {
  return (
    <Tip content={tooltip} className="flex min-w-0 items-stretch gap-2 px-1 py-1 hover:bg-muted/60">
      <KindBar kind={kind} />
      <span className="flex min-w-0 flex-col">
        {lines.map((s, i) => (
          <span key={i} className="truncate text-xs font-medium tabular-nums">{s.start}–{s.end}</span>
        ))}
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {locked && <Lock className="size-3 shrink-0" aria-label="Değiştirilemez" />}
          <span className="truncate">{sub}</span>
        </span>
      </span>
    </Tip>
  )
}

const dayCellCls = 'px-1 py-1.5 whitespace-normal'

// ─── Mevcut plan ──────────────────────────────────────────────

function CurrentDayCell({ day }: { day: DaySummary | undefined }) {
  if (!day || (!day.isLeave && day.shifts.length === 0)) return <div className="px-1"><Dash /></div>
  if (day.isLeave) return <div className="px-1"><Badge tone="info">İzinli</Badge></div>
  const gross = day.shifts.reduce((s, x) => s + shiftDurationMins(x.start_time, x.end_time), 0)
  const first = day.shifts[0]
  const kind = kindOf(first.start_time, first.end_time)
  return (
    <ShiftCell
      kind={kind}
      lines={day.shifts.map((s) => ({ start: hhmm(s.start_time), end: hhmm(s.end_time) }))}
      sub={`${fmtDuration(day.totalMins)} net`}
      tooltip={`${SHIFT_KIND_LABELS[kind]} · Brüt ${fmtDuration(gross)} · Mola ${fmtDuration(gross - day.totalMins)} · Net ${fmtDuration(day.totalMins)}`}
    />
  )
}

function ViolationCell({ violations }: { violations: WorkingTimeViolation[] }) {
  if (violations.length === 0) return <Dash />
  const isError = violations.some((v) => v.severity === 'error')
  return (
    <Tip content={violations.map((v) => `• ${v.message}`).join('\n')} className="inline-flex">
      <span className={cn('inline-flex items-center gap-1 font-medium tabular-nums', isError ? 'text-destructive' : 'text-warning')}>
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
        const maxH = s.employment_type === 'part_time' ? PART_TIME_RULES.maxWeeklyHours : maxWeeklyWorkHours
        const isOver = s.totalWeeklyMins > maxH * 60
        const daysOver = s.weeklyWorkDays > PART_TIME_RULES.maxWeeklyDays
        return (
          <TableRow key={s.employeeId} className="hover:bg-transparent">
            <NameCell
              name={s.employeeName}
              sub={s.employment_type === 'part_time'
                ? <>{employmentLabel(s.employment_type)} · <span className={cn(daysOver && 'text-destructive')}>{s.weeklyWorkDays}/{PART_TIME_RULES.maxWeeklyDays} gün</span></>
                : employmentLabel(s.employment_type)}
            />
            {weekDays.map((d) => (
              <TableCell key={d} className={dayCellCls}><CurrentDayCell day={s.days[d]} /></TableCell>
            ))}
            <TableCell className="px-2 text-right">
              <div className={cn('font-medium tabular-nums', isOver ? 'text-destructive' : s.totalWeeklyMins === 0 && 'text-muted-foreground')}>
                {fmtDuration(s.totalWeeklyMins)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">/ {maxH}s</div>
            </TableCell>
            <TableCell className="pr-4 pl-2 text-right"><ViolationCell violations={s.violations} /></TableCell>
          </TableRow>
        )
      })}
      {summaries.length === 0 && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={weekDays.length + 3} className="py-10 text-center text-muted-foreground">
            Bu hafta için vardiya planı bulunamadı.
          </TableCell>
        </TableRow>
      )}
    </TableFrame>
  )
}

// ─── Taslak ───────────────────────────────────────────────────

function DraftDayCell({ assign }: { assign: DraftAssignment | undefined }) {
  if (!assign) return <div className="px-1"><Dash /></div>
  const gross = shiftDurationMins(assign.start_time, assign.end_time)
  const net = netWorkMins(assign.start_time, assign.end_time)
  const label = SHIFT_KIND_LABELS[assign.shift_kind] ?? 'Vardiya'
  return (
    <ShiftCell
      kind={assign.shift_kind}
      lines={[{ start: hhmm(assign.start_time), end: hhmm(assign.end_time) }]}
      sub={assign.overtime ? 'Fazla mesai' : `${fmtDuration(net)} net`}
      locked={assign.worked}
      tooltip={[
        `${label}${assign.worked ? ' · değiştirilemez' : ''}`,
        `Brüt ${fmtDuration(gross)} · Mola ${fmtDuration(gross - net)} · Net ${fmtDuration(net)}`,
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
        return (
          <TableRow key={stat.employeeId} className="hover:bg-transparent">
            <NameCell name={stat.employeeName} sub={`${employmentLabel(stat.employment_type)} · ${stat.workDays} gün`} />
            {weekDays.map((d) => (
              <TableCell key={d} className={dayCellCls}><DraftDayCell assign={byDate[d]} /></TableCell>
            ))}
            <TableCell className="px-2 text-right">
              <Tip content={`Hedef ${targetH}s · %${pct}`} className="ml-auto flex w-14 flex-col items-end gap-1">
                <span className="font-medium tabular-nums">{fmtDuration(stat.totalMins)}</span>
                <Progress value={pct} aria-label={`Hedefin %${pct}'i`} className="h-1" />
              </Tip>
            </TableCell>
            <TableCell className="pr-4 pl-2 text-right">
              <Tip content={`Açılış: ${stat.openingCount} · Kapanış: ${stat.closingCount} · Full: ${stat.fullCount}`} className="inline-block">
                <span className="text-sm font-medium tabular-nums">
                  <span style={{ color: toneOf('opening').text }}>{stat.openingCount}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span style={{ color: toneOf('closing').text }}>{stat.closingCount}</span>
                </span>
              </Tip>
            </TableCell>
          </TableRow>
        )
      })}
    </TableFrame>
  )
}
