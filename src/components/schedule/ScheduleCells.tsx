'use client'

/**
 * ScheduleCells — haftalık plan tablosunun hücreleri (yeni UI):
 * vardiya türü renkli kutular (Açılış / Ortacı / Kapanış), Tatil, İzinli, boş hücre,
 * haftalık özet halkası ve mobil hafta görünümünün mini hücreleri.
 */
import { Armchair, Plane, Plus, TriangleAlert } from 'lucide-react'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { formatTime } from '@/types/shiftTemplate'
import { shiftDurationMins, netWorkMins } from '@/lib/workingTimeService'
import { PART_TIME_RULES } from '@/types/employee'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { C, SHIFT_KIND_TONES } from '@/lib/palette'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { fmtHours, fmtHoursTr, shiftDisplayName, shiftKindOf, EmployeeWeekStats, AvailStatus } from './scheduleHelpers'

// ─── Haftalık özet ────────────────────────────────────────────

export function weeklyLimitMins(stats: EmployeeWeekStats, config: ReturnType<typeof getWorkingTimeConfig>): number {
  return (stats.employment_type === 'part_time' ? PART_TIME_RULES.maxWeeklyHours : config.maxWeeklyWorkHours) * 60
}

/** Haftalık hedefe göre dolan halka */
export function WeekRing({ value, max, over, size = 26 }: { value: number; max: number; over: boolean; size?: number }) {
  const stroke = 3
  const r = (size - stroke) / 2
  const len = 2 * Math.PI * r
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? C.dangerFill : C.success} strokeWidth={stroke}
        strokeDasharray={`${len * ratio} ${len}`} strokeLinecap="round"
      />
    </svg>
  )
}

/** Çok satırlı ipucu sarmalayıcısı */
function Tip({ text, children, side = 'top' }: { text: React.ReactNode; children: React.ReactElement; side?: 'top' | 'left' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{text}</TooltipContent>
    </Tooltip>
  )
}

export function SummaryCell({ stats, config }: {
  stats: EmployeeWeekStats | undefined
  config: ReturnType<typeof getWorkingTimeConfig>
}) {
  if (!stats) {
    return <div className="flex items-center px-3 text-xs text-ink-muted">—</div>
  }
  const maxMins = weeklyLimitMins(stats, config)
  const over = stats.totalMins > maxMins
  const rest = stats.restViolations.length
  const note = over
    ? rest ? `limit + ${rest} dinlenme` : 'haftalık limit üstü'
    : rest ? `${rest} dinlenme` : 'her şey yolunda'
  const restTooltip = stats.restViolations
    .map((v) => `${v.between} (${Math.round(v.restMins / 60 * 10) / 10}s dinlenme)`)
    .join('\n')
  const tooltip = [
    `Net ${fmtHours(stats.totalMins)} / maks. ${maxMins / 60}s · ${fmtHours(stats.totalBreakMins)} mola`,
    rest ? `Min. dinlenme ihlali:\n${restTooltip}` : '',
  ].filter(Boolean).join('\n')

  return (
    <Tip text={tooltip} side="left">
      <div className="flex min-w-0 items-center gap-2.5 px-3 py-2">
        <WeekRing value={stats.totalMins} max={maxMins} over={over} />
        <div className="min-w-0">
          <p className={cn('truncate text-[0.82rem] font-bold', over && 'text-danger')}>
            {(Math.round(stats.totalMins / 6) / 10).toLocaleString('tr-TR')} / {maxMins / 60} s
          </p>
          <p className={cn('truncate text-[0.68rem]', over || rest ? 'text-danger' : 'text-ink-secondary')}>{note}</p>
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
  'flex h-full min-h-[46px] w-full min-w-0 flex-col items-start justify-center rounded-[10px] px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Tıklanabilir hücre; salt okunurda düz kutu (ipucu yine çalışır) */
function CellButton({ readOnly, onClick, className, style, children, ...rest }: {
  readOnly?: boolean
  onClick: () => void
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
  'aria-label'?: string
}) {
  if (readOnly) return <div className={className} style={style} aria-label={rest['aria-label']}>{children}</div>
  return <button type="button" onClick={onClick} className={className} style={style} aria-label={rest['aria-label']}>{children}</button>
}

function OffBox({ icon, label, className, onClick, readOnly, title }: {
  icon: React.ReactNode; label: string; className: string; onClick: () => void; readOnly?: boolean; title: string
}) {
  return (
    <Tip text={title}>
      <CellButton
        readOnly={readOnly}
        onClick={onClick}
        className={cn(cellBase, 'flex-row items-center justify-start gap-1.5 [&_svg]:size-[15px]', className)}
      >
        {icon}
        <span className="text-xs font-semibold">{label}</span>
      </CellButton>
    </Tip>
  )
}

// ─── Vardiya hücresi (masaüstü / geniş tablo) ─────────────────

export function ShiftCell({ assignment, isOnLeave, isRestDay, availStatus, dailyOver, onClick, readOnly }: ShiftCellProps) {
  if (isRestDay) {
    return (
      <OffBox
        icon={<Armchair />} label="Tatil" className="bg-surface-muted text-ink-secondary"
        onClick={onClick} readOnly={readOnly}
        title={readOnly ? 'Haftalık tatil' : 'Haftalık tatil — tıklayarak kaldırabilirsiniz'}
      />
    )
  }
  if (isOnLeave) {
    const t = assignment ? ` (${formatTime(assignment.start_time)}–${formatTime(assignment.end_time)})` : ''
    return (
      <OffBox
        icon={<Plane />} label="İzinli" className="bg-success-soft text-success"
        onClick={onClick} readOnly={readOnly} title={`İzin onaylandı${t}`}
      />
    )
  }
  if (!assignment) {
    if (availStatus === 'off') {
      return (
        <Tip text="Çalışan bu gün müsait değil">
          <CellButton
            readOnly={readOnly}
            onClick={onClick}
            className={cn(cellBase, 'items-center border border-dashed border-danger-fill text-danger')}
          >
            <span className="text-xs font-semibold">Müsait değil</span>
          </CellButton>
        </Tip>
      )
    }
    if (readOnly) return <div className="min-h-[46px]" />
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Vardiya ekle"
        className={cn(
          cellBase,
          'flex-row items-center justify-center gap-1 border border-dashed border-sand text-ink-muted opacity-55 transition-opacity hover:bg-muted hover:text-ink-secondary hover:opacity-100 focus-visible:opacity-100'
        )}
      >
        <Plus className="size-[15px]" />
        <span className="text-xs font-semibold">Ekle</span>
      </button>
    )
  }

  const start = formatTime(assignment.start_time)
  const end = formatTime(assignment.end_time)
  const name = shiftDisplayName(assignment.shift_templates?.name, start, end)
  const tone = SHIFT_KIND_TONES[shiftKindOf(assignment.shift_templates?.name, start, end)]
  const grossMins = shiftDurationMins(assignment.start_time, assignment.end_time)
  const netMins = netWorkMins(assignment.start_time, assignment.end_time)
  const availWarn = availStatus === 'off' || availStatus === 'partial'

  const tooltipText = [
    `${name}: ${start}–${end}`,
    `Brüt ${fmtHours(grossMins)} · Mola ${fmtHours(grossMins - netMins)} · Net ${fmtHours(netMins)}`,
    dailyOver ? '⚠️ Günlük maks. aşıldı' : '',
    availStatus === 'off' ? '⚠️ Müsait değil gün' : '',
    availStatus === 'partial' ? '⚠️ Müsaitlik penceresi dışı' : '',
  ].filter(Boolean).join('\n')

  return (
    <Tip text={tooltipText}>
      <CellButton
        readOnly={readOnly}
        onClick={onClick}
        className={cn(cellBase, !readOnly && 'hover:brightness-[0.97]')}
        style={{
          backgroundColor: dailyOver ? C.dangerSoft : tone.soft,
          color: dailyOver ? C.danger : tone.text,
          boxShadow: availWarn ? `inset 0 0 0 1.5px ${availStatus === 'off' ? C.dangerFill : C.warningFill}` : undefined,
        }}
      >
        <span className="flex w-full items-center gap-1">
          <span className="truncate text-[0.8rem] font-bold tabular-nums">{start} – {end}</span>
          {availWarn && <TriangleAlert className={cn('ml-auto size-[13px] shrink-0', availStatus === 'off' ? 'text-danger' : 'text-warning')} />}
        </span>
        <span className="w-full truncate text-[0.68rem] font-medium opacity-85">
          {dailyOver ? `${fmtHoursTr(netMins)} · limit üstü` : `${name} · ${fmtHoursTr(netMins)}`}
        </span>
      </CellButton>
    </Tip>
  )
}

// ─── Mini hücre (mobil hafta görünümü) ────────────────────────

const miniBase = 'flex h-[34px] w-full items-center justify-center rounded-lg text-[0.78rem] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5'

export function MiniShiftCell({ assignment, isOnLeave, isRestDay, availStatus, dailyOver, onClick, readOnly }: ShiftCellProps) {
  if (isRestDay) {
    return (
      <CellButton readOnly={readOnly} onClick={onClick} aria-label="Tatil" className={cn(miniBase, 'bg-surface-muted text-ink-secondary')}>
        <Armchair />
      </CellButton>
    )
  }
  if (isOnLeave) {
    return (
      <CellButton readOnly={readOnly} onClick={onClick} aria-label="İzinli" className={cn(miniBase, 'bg-success-soft text-success')}>
        <Plane />
      </CellButton>
    )
  }
  if (!assignment) {
    if (readOnly && availStatus !== 'off') return <div className="h-[34px]" />
    return (
      <CellButton
        readOnly={readOnly}
        onClick={onClick}
        aria-label={availStatus === 'off' ? 'Müsait değil' : 'Vardiya ekle'}
        className={cn(miniBase, 'border border-dashed', availStatus === 'off' ? 'border-danger-fill text-danger' : 'border-sand text-ink-muted')}
      >
        {availStatus === 'off' ? '—' : <Plus />}
      </CellButton>
    )
  }
  const start = formatTime(assignment.start_time)
  const end = formatTime(assignment.end_time)
  const tone = SHIFT_KIND_TONES[shiftKindOf(assignment.shift_templates?.name, start, end)]
  const warn = dailyOver || availStatus === 'off' || availStatus === 'partial'
  return (
    <CellButton
      readOnly={readOnly}
      onClick={onClick}
      aria-label={`${shiftDisplayName(assignment.shift_templates?.name, start, end)} ${start}–${end}`}
      className={miniBase}
      style={{
        backgroundColor: dailyOver ? C.dangerSoft : tone.soft,
        color: dailyOver ? C.danger : tone.text,
        boxShadow: warn ? `inset 0 0 0 1.5px ${dailyOver || availStatus === 'off' ? C.dangerFill : C.warningFill}` : undefined,
      }}
    >
      {start.slice(0, 2)}
    </CellButton>
  )
}
