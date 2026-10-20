'use client'

/**
 * ScheduleCells — haftalık plan tablosunun hücreleri (DESIGN_GUIDE §5):
 *   ShiftCell        masaüstü hücresi: vardiya türü renk çubuğu + saat + süre; tatil / izin /
 *                    müsait değil durumları çizgili nötr zeminde ikonla; boş hücrede yöneticiye "+"
 *   MiniShiftCell    mobil hafta görünümü (başlangıç saati + tür çizgisi)
 *   SummaryCell      çalışanın haftalık net saati, limit çubuğu ve limit üstü rozeti
 *   ShiftKindBar / ShiftKindLegend
 *
 * Satır içi `style` yalnızca vardiya türü rengi (SHIFT_KIND_TONES) ve çubuk genişliği içindir.
 */
import { Armchair, Ban, Plane, Plus, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { shiftDurationMins, netWorkMins } from '@/lib/workingTimeService'
import { PART_TIME_RULES } from '@/types/employee'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import type { ShiftKind } from '@/lib/workforcePlanner'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  fmtDuration, fmtHoursTr, fmtRange, shiftDisplayName, shiftKindOf, type AvailStatus, type EmployeeWeekStats,
} from './scheduleHelpers'

// ─── Ortak parçalar ───────────────────────────────────────────

export const SHIFT_KIND_LABELS: Record<ShiftKind, string> = {
  opening: 'Açılış',
  mid: 'Ortacı',
  closing: 'Kapanış',
  full: 'Full',
  custom: 'Özel',
}

/** Vardiya dışı durumlar: çizgili nötr zemin + ikon */
export type OffKind = 'rest' | 'leave' | 'unavailable'
export const OFF_META: Record<OffKind, { label: string; icon: LucideIcon }> = {
  rest: { label: 'Tatil', icon: Armchair },
  leave: { label: 'İzinli', icon: Plane },
  unavailable: { label: 'Müsait değil', icon: Ban },
}

/** Tatil / izin hücrelerinin ince çapraz çizgili zemini */
export const STRIPES = 'bg-muted/40 bg-[image:repeating-linear-gradient(135deg,var(--border)_0_1px,transparent_1px_7px)]'

/** Vardiya türünün dikey renk çubuğu */
export function ShiftKindBar({ kind, className }: { kind: ShiftKind; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('w-1 shrink-0 rounded-full', className)}
      style={{ backgroundColor: SHIFT_KIND_TONES[kind].fill }}
    />
  )
}

/** Açılış / Ortacı / Kapanış … renk lejantı */
export function ShiftKindLegend({ kinds, className }: { kinds: ShiftKind[]; className?: string }) {
  if (kinds.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', className)}>
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <ShiftKindBar kind={k} className="h-3" />
          {SHIFT_KIND_LABELS[k]}
        </span>
      ))}
    </div>
  )
}

/** Hücre ipucu */
function Tip({ text, children, side = 'top' }: { text: React.ReactNode; children: React.ReactElement; side?: 'top' | 'left' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  )
}

/** Tıklanabilir hücre; salt okunurda düz kutu (ipucu yine çalışır) */
function CellButton({ readOnly, onClick, className, children, ...rest }: {
  readOnly?: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
  'aria-label'?: string
}) {
  if (readOnly) return <div className={className} aria-label={rest['aria-label']}>{children}</div>
  return (
    <button type="button" onClick={onClick} className={className} aria-label={rest['aria-label']}>
      {children}
    </button>
  )
}

// ─── Haftalık özet ────────────────────────────────────────────

export function weeklyLimitMins(stats: EmployeeWeekStats, config: ReturnType<typeof getWorkingTimeConfig>): number {
  return (stats.employment_type === 'part_time' ? PART_TIME_RULES.maxWeeklyHours : config.maxWeeklyWorkHours) * 60
}

const hoursNum = (mins: number) => (Math.round(mins / 6) / 10).toLocaleString('tr-TR')

export function SummaryCell({ stats, config }: {
  stats: EmployeeWeekStats | undefined
  config: ReturnType<typeof getWorkingTimeConfig>
}) {
  if (!stats) return <span className="px-3 text-sm text-muted-foreground">—</span>
  const maxMins = weeklyLimitMins(stats, config)
  const over = stats.totalMins > maxMins
  const rest = stats.restViolations.length
  const ratio = maxMins > 0 ? Math.min(1, stats.totalMins / maxMins) : 0

  const tooltip = (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">Net {fmtHoursTr(stats.totalMins)} / azami {maxMins / 60} s</span>
      <span>Toplam mola {fmtDuration(stats.totalBreakMins)}</span>
      {over && <span>Haftalık limit {fmtHoursTr(stats.totalMins - maxMins)} aşıldı</span>}
      {rest > 0 && (
        <>
          <span className="mt-1 font-medium">Asgari dinlenme ihlali</span>
          {stats.restViolations.map((v) => (
            <span key={v.between} className="tabular-nums">{v.between} ({fmtDuration(v.restMins)} dinlenme)</span>
          ))}
        </>
      )}
    </div>
  )

  return (
    <Tip text={tooltip} side="left">
      <div className="flex min-w-0 flex-col gap-1.5 px-3">
        <div className="flex items-center gap-1">
          <span className={cn('text-sm font-medium tabular-nums', over && 'text-destructive')}>{hoursNum(stats.totalMins)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">/ {maxMins / 60} s</span>
          {over ? (
            <Badge tone="danger" className="ml-auto px-1.5 tabular-nums">+{hoursNum(stats.totalMins - maxMins)}</Badge>
          ) : rest > 0 ? (
            <TriangleAlert aria-label={`${rest} dinlenme uyarısı`} className="ml-auto size-3.5 shrink-0 text-warning" />
          ) : null}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', over ? 'bg-destructive' : 'bg-muted-foreground/40')}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>
    </Tip>
  )
}

// ─── Hücre ortak tipleri ──────────────────────────────────────

export interface ShiftCellProps {
  assignment: ShiftAssignmentWithDetails | null
  isOnLeave: boolean
  isRestDay: boolean
  availStatus: AvailStatus
  dailyOver: boolean
  onClick: () => void
  readOnly?: boolean
}

const cellBase =
  'relative flex h-12 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50'

function OffCell({ kind, readOnly, onClick, tip }: { kind: OffKind; readOnly?: boolean; onClick: () => void; tip: React.ReactNode }) {
  const { icon: Icon, label } = OFF_META[kind]
  return (
    <Tip text={tip}>
      <CellButton
        readOnly={readOnly}
        onClick={onClick}
        className={cn(
          cellBase,
          'text-muted-foreground',
          kind === 'unavailable' ? 'border border-dashed' : STRIPES,
          !readOnly && 'hover:bg-muted hover:text-foreground'
        )}
      >
        {kind !== 'unavailable' && <Icon aria-hidden className="size-3.5 shrink-0" />}
        <span className="truncate text-xs">{label}</span>
      </CellButton>
    </Tip>
  )
}

// ─── Vardiya hücresi (masaüstü tablo) ─────────────────────────

export function ShiftCell({ assignment, isOnLeave, isRestDay, availStatus, dailyOver, onClick, readOnly }: ShiftCellProps) {
  if (isRestDay) {
    return (
      <OffCell
        kind="rest" readOnly={readOnly} onClick={onClick}
        tip={readOnly ? 'Haftalık tatil' : 'Haftalık tatil — kaldırmak için tıklayın'}
      />
    )
  }
  if (isOnLeave) {
    const t = assignment ? ` (${fmtRange(assignment.start_time, assignment.end_time)})` : ''
    return <OffCell kind="leave" readOnly={readOnly} onClick={onClick} tip={`Onaylı izin${t}`} />
  }
  if (!assignment) {
    if (availStatus === 'off') {
      return <OffCell kind="unavailable" readOnly={readOnly} onClick={onClick} tip="Çalışan bu gün müsait değil" />
    }
    if (readOnly) return <div className="h-12" />
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Vardiya ekle"
        className={cn(
          cellBase,
          'group/add justify-center border border-dashed border-transparent text-muted-foreground',
          'hover:border-border hover:bg-muted/50 hover:text-foreground focus-visible:border-border'
        )}
      >
        <Plus className="size-4 opacity-0 transition-opacity group-hover/add:opacity-100 group-focus-visible/add:opacity-100" />
      </button>
    )
  }

  const start = assignment.start_time.slice(0, 5)
  const end = assignment.end_time.slice(0, 5)
  const name = shiftDisplayName(assignment.shift_templates?.name, start, end)
  const kind = shiftKindOf(assignment.shift_templates?.name, start, end)
  const grossMins = shiftDurationMins(assignment.start_time, assignment.end_time)
  const netMins = netWorkMins(assignment.start_time, assignment.end_time)
  const availWarn = availStatus === 'off' || availStatus === 'partial'
  const danger = dailyOver || availStatus === 'off'

  const tooltip = (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{name} · {fmtRange(start, end)}</span>
      <span>Brüt {fmtDuration(grossMins)} · mola {fmtDuration(grossMins - netMins)} · net {fmtDuration(netMins)}</span>
      {dailyOver && <span>Günlük azami çalışma süresi aşıldı</span>}
      {availStatus === 'off' && <span>Çalışan bu gün müsait değil</span>}
      {availStatus === 'partial' && <span>Müsaitlik penceresinin dışında</span>}
    </div>
  )

  return (
    <Tip text={tooltip}>
      <CellButton
        readOnly={readOnly}
        onClick={onClick}
        className={cn(
          cellBase,
          !readOnly && 'hover:bg-muted',
          danger ? 'bg-destructive/5 hover:bg-destructive/10' : availWarn && 'bg-warning/10 hover:bg-warning/15'
        )}
      >
        <ShiftKindBar kind={kind} className="h-8" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn('truncate text-xs font-medium tabular-nums', dailyOver && 'text-destructive')}>
            {fmtRange(start, end)}
          </span>
          <span className="flex min-w-0 gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{name}</span>
            <span className={cn('ml-auto flex shrink-0 items-center gap-0.5 tabular-nums', dailyOver && 'text-destructive')}>
              {(availWarn || dailyOver) && (
                <TriangleAlert
                  aria-label={dailyOver ? 'Günlük limit üstü' : availStatus === 'off' ? 'Müsait değil' : 'Müsaitlik dışı'}
                  className={cn('size-3', danger ? 'text-destructive' : 'text-warning')}
                />
              )}
              {fmtDuration(netMins)}
            </span>
          </span>
        </span>
      </CellButton>
    </Tip>
  )
}

// ─── Mini hücre (mobil hafta görünümü) ────────────────────────

const miniBase =
  'relative flex h-10 w-full flex-col items-center justify-center gap-1 rounded-md text-xs font-medium tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-3.5'

export function MiniShiftCell({ assignment, isOnLeave, isRestDay, availStatus, dailyOver, onClick, readOnly }: ShiftCellProps) {
  if (isRestDay || isOnLeave) {
    const { icon: Icon, label } = OFF_META[isRestDay ? 'rest' : 'leave']
    return (
      <CellButton readOnly={readOnly} onClick={onClick} aria-label={label} className={cn(miniBase, STRIPES, 'text-muted-foreground')}>
        <Icon />
      </CellButton>
    )
  }
  if (!assignment) {
    if (readOnly && availStatus !== 'off') return <div className="h-10" />
    const off = availStatus === 'off'
    return (
      <CellButton
        readOnly={readOnly}
        onClick={onClick}
        aria-label={off ? 'Müsait değil' : 'Vardiya ekle'}
        className={cn(miniBase, 'border border-dashed', off ? 'text-muted-foreground' : 'text-muted-foreground/50')}
      >
        {off ? <Ban /> : <Plus />}
      </CellButton>
    )
  }
  const start = assignment.start_time.slice(0, 5)
  const end = assignment.end_time.slice(0, 5)
  const kind = shiftKindOf(assignment.shift_templates?.name, start, end)
  const warn = dailyOver || availStatus === 'off' || availStatus === 'partial'
  return (
    <CellButton
      readOnly={readOnly}
      onClick={onClick}
      aria-label={`${shiftDisplayName(assignment.shift_templates?.name, start, end)} ${fmtRange(start, end)}`}
      className={cn(
        miniBase,
        'border bg-card shadow-xs',
        warn && (dailyOver || availStatus === 'off' ? 'border-destructive/50 text-destructive' : 'border-warning/50')
      )}
    >
      {start.slice(0, 2)}
      <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: SHIFT_KIND_TONES[kind].fill }} />
    </CellButton>
  )
}
