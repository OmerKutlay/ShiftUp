'use client'

/**
 * ScheduleCells — haftalık plan tablosunun hücreleri (yeni UI):
 * vardiya türü renkli kutular (Açılış / Ortacı / Kapanış), Tatil, İzinli, boş hücre,
 * haftalık özet halkası ve mobil hafta görünümünün mini hücreleri.
 */
import { Box, ButtonBase, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import WeekendOutlinedIcon from '@mui/icons-material/WeekendOutlined'
import FlightTakeoffOutlinedIcon from '@mui/icons-material/FlightTakeoffOutlined'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { formatTime } from '@/types/shiftTemplate'
import { shiftDurationMins, netWorkMins } from '@/lib/workingTimeService'
import { PART_TIME_RULES } from '@/types/employee'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { C, SHIFT_KIND_TONES } from '@/lib/palette'

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
  const color = over ? C.dangerFill : C.success
  return (
    <Box component="svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden sx={{ flexShrink: 0, transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.border} strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${len * ratio} ${len}`} strokeLinecap="round"
      />
    </Box>
  )
}

export function SummaryCell({ stats, config }: {
  stats: EmployeeWeekStats | undefined
  config: ReturnType<typeof getWorkingTimeConfig>
}) {
  if (!stats) {
    return <Box sx={{ px: 1.5, display: 'flex', alignItems: 'center' }}><Typography variant="caption" color="text.disabled">—</Typography></Box>
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
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{tooltip}</Box>} placement="left">
      <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        <WeekRing value={stats.totalMins} max={maxMins} over={over} />
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={700} fontSize="0.82rem" color={over ? C.danger : 'text.primary'} noWrap>
            {(Math.round(stats.totalMins / 6) / 10).toLocaleString('tr-TR')} / {maxMins / 60} s
          </Typography>
          <Typography fontSize="0.68rem" color={over || rest ? C.danger : 'text.secondary'} noWrap>{note}</Typography>
        </Box>
      </Box>
    </Tooltip>
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

const boxBase = {
  width: '100%',
  height: '100%',
  minHeight: 46,
  borderRadius: '10px',
  px: 1,
  py: 0.75,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'flex-start',
  textAlign: 'left',
  fontFamily: 'inherit',
  minWidth: 0,
  '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.light' },
  '&.Mui-disabled': { opacity: 1 },
} as const

function OffBox({ icon, label, bg, fg, onClick, readOnly, title }: {
  icon: React.ReactNode; label: string; bg: string; fg: string; onClick: () => void; readOnly?: boolean; title: string
}) {
  return (
    <Tooltip title={title} placement="top">
      <ButtonBase
        onClick={onClick}
        disabled={readOnly}
        sx={{ ...boxBase, bgcolor: bg, color: fg, flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', gap: 0.75, '& svg': { fontSize: 15 } }}
      >
        {icon}
        <Typography fontSize="0.75rem" fontWeight={600}>{label}</Typography>
      </ButtonBase>
    </Tooltip>
  )
}

// ─── Vardiya hücresi (masaüstü / geniş tablo) ─────────────────

export function ShiftCell({ assignment, isOnLeave, isRestDay, availStatus, dailyOver, onClick, readOnly }: ShiftCellProps) {
  if (isRestDay) {
    return (
      <OffBox
        icon={<WeekendOutlinedIcon />} label="Tatil" bg={C.surfaceMuted} fg={C.inkSecondary}
        onClick={onClick} readOnly={readOnly}
        title={readOnly ? 'Haftalık tatil' : 'Haftalık tatil — tıklayarak kaldırabilirsiniz'}
      />
    )
  }
  if (isOnLeave) {
    const t = assignment ? ` (${formatTime(assignment.start_time)}–${formatTime(assignment.end_time)})` : ''
    return (
      <OffBox
        icon={<FlightTakeoffOutlinedIcon />} label="İzinli" bg={C.successSoft} fg={C.success}
        onClick={onClick} readOnly={readOnly} title={`İzin onaylandı${t}`}
      />
    )
  }
  if (!assignment) {
    if (availStatus === 'off') {
      return (
        <Tooltip title="Çalışan bu gün müsait değil" placement="top">
          <ButtonBase
            onClick={onClick}
            disabled={readOnly}
            sx={{ ...boxBase, border: `1px dashed ${C.dangerFill}`, color: C.danger, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}
          >
            <Typography fontSize="0.72rem" fontWeight={600}>Müsait değil</Typography>
          </ButtonBase>
        </Tooltip>
      )
    }
    if (readOnly) return <Box sx={{ minHeight: 46 }} />
    return (
      <ButtonBase
        onClick={onClick}
        aria-label="Vardiya ekle"
        sx={{
          ...boxBase, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 0.5,
          border: `1px dashed ${C.sand}`, color: 'text.disabled',
          opacity: 0.55, transition: 'opacity 0.15s',
          '&:hover, &.Mui-focusVisible': { opacity: 1, color: 'text.secondary', bgcolor: C.surfaceAlt },
        }}
      >
        <AddIcon sx={{ fontSize: 15 }} />
        <Typography fontSize="0.75rem" fontWeight={600}>Ekle</Typography>
      </ButtonBase>
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
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line' }}>{tooltipText}</Box>} placement="top">
      <ButtonBase
        onClick={onClick}
        disabled={readOnly}
        sx={{
          ...boxBase,
          bgcolor: dailyOver ? C.dangerSoft : tone.soft,
          color: dailyOver ? C.danger : tone.text,
          boxShadow: availWarn ? `inset 0 0 0 1.5px ${availStatus === 'off' ? C.dangerFill : C.warningFill}` : undefined,
          '&:hover': { filter: readOnly ? undefined : 'brightness(0.97)' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
          <Typography fontSize="0.8rem" fontWeight={700} noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {start} – {end}
          </Typography>
          {availWarn && <WarningAmberIcon sx={{ fontSize: 13, ml: 'auto', color: availStatus === 'off' ? C.danger : C.warning }} />}
        </Box>
        <Typography fontSize="0.68rem" fontWeight={500} noWrap sx={{ opacity: 0.85, width: '100%' }}>
          {dailyOver ? `${fmtHoursTr(netMins)} · limit üstü` : `${name} · ${fmtHoursTr(netMins)}`}
        </Typography>
      </ButtonBase>
    </Tooltip>
  )
}

// ─── Mini hücre (mobil hafta görünümü) ────────────────────────

export function MiniShiftCell({ assignment, isOnLeave, isRestDay, availStatus, dailyOver, onClick, readOnly }: ShiftCellProps) {
  const sx = {
    width: '100%', height: 34, borderRadius: '8px', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.78rem',
    '& svg': { fontSize: 14 }, '&.Mui-disabled': { opacity: 1 },
  } as const
  if (isRestDay) {
    return (
      <ButtonBase onClick={onClick} disabled={readOnly} aria-label="Tatil" sx={{ ...sx, bgcolor: C.surfaceMuted, color: C.inkSecondary }}>
        <WeekendOutlinedIcon />
      </ButtonBase>
    )
  }
  if (isOnLeave) {
    return (
      <ButtonBase onClick={onClick} disabled={readOnly} aria-label="İzinli" sx={{ ...sx, bgcolor: C.successSoft, color: C.success }}>
        <FlightTakeoffOutlinedIcon />
      </ButtonBase>
    )
  }
  if (!assignment) {
    if (readOnly && availStatus !== 'off') return <Box sx={sx} />
    return (
      <ButtonBase
        onClick={onClick}
        disabled={readOnly}
        aria-label={availStatus === 'off' ? 'Müsait değil' : 'Vardiya ekle'}
        sx={{ ...sx, border: `1px dashed ${availStatus === 'off' ? C.dangerFill : C.sand}`, color: availStatus === 'off' ? C.danger : 'text.disabled' }}
      >
        {availStatus === 'off' ? '—' : <AddIcon />}
      </ButtonBase>
    )
  }
  const start = formatTime(assignment.start_time)
  const end = formatTime(assignment.end_time)
  const tone = SHIFT_KIND_TONES[shiftKindOf(assignment.shift_templates?.name, start, end)]
  const warn = dailyOver || availStatus === 'off' || availStatus === 'partial'
  return (
    <ButtonBase
      onClick={onClick}
      disabled={readOnly}
      aria-label={`${shiftDisplayName(assignment.shift_templates?.name, start, end)} ${start}–${end}`}
      sx={{
        ...sx,
        bgcolor: dailyOver ? C.dangerSoft : tone.soft,
        color: dailyOver ? C.danger : tone.text,
        boxShadow: warn ? `inset 0 0 0 1.5px ${dailyOver || availStatus === 'off' ? C.dangerFill : C.warningFill}` : undefined,
      }}
    >
      {start.slice(0, 2)}
    </ButtonBase>
  )
}
