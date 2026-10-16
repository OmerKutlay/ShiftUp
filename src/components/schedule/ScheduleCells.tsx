'use client'

/**
 * ScheduleCells — haftalık plan tablosunun özet ve vardiya hücreleri.
 */
import {
  Box,
  Typography,
  Chip,
  Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import WeekendIcon from '@mui/icons-material/Weekend'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import { formatTime } from '@/types/shiftTemplate'
import { shiftDurationMins, netWorkMins } from '@/lib/workingTimeService'
import { PART_TIME_RULES } from '@/types/employee'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'

import { fmtHours, shiftDisplayName, EmployeeWeekStats, AvailStatus } from './scheduleHelpers'

// ─── Özet sütunu hücresi ──────────────────────────────────────
export interface SummaryCellProps {
  stats: EmployeeWeekStats | undefined
  config: ReturnType<typeof getWorkingTimeConfig>
  /** Dar ekran (mobil): yalnızca toplam, ihlal sayısı ve ilerleme çubuğu */
  compact?: boolean
}

export function SummaryCell({ stats, config, compact = false }: SummaryCellProps) {
  if (!stats) {
    return (
      <Box sx={{
        borderLeft: '2px solid', borderColor: 'rgba(20,184,166,0.3)',
        bgcolor: 'rgba(20,184,166,0.02)', p: 1, minHeight: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography variant="caption" color="text.disabled" fontSize="0.68rem">—</Typography>
      </Box>
    )
  }

  const totalH = Math.round(stats.totalMins / 60 * 10) / 10
  // Part-time için 30s, full-time için config'den
  const maxW = stats.employment_type === 'part_time'
    ? PART_TIME_RULES.maxWeeklyHours
    : config.maxWeeklyWorkHours
  const overWeekly = stats.totalMins > maxW * 60
  const hasRestViolation = stats.restViolations.length > 0

  const restTooltip = stats.restViolations
    .map((v) => `${v.between}\n(${Math.round(v.restMins / 60 * 10) / 10}s dinlenme)`)
    .join('\n')

  return (
    <Box sx={{
      borderLeft: '2px solid', borderColor: 'rgba(20,184,166,0.3)',
      bgcolor: 'rgba(20,184,166,0.02)', p: 1, minHeight: 64,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.5,
    }}>
      {/* Haftalık toplam */}
      <Tooltip title={`Haftalık toplam / Maks. ${maxW}s`} placement="left">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Typography
            variant="caption"
            fontWeight={700}
            fontSize="0.82rem"
            color={overWeekly ? '#ef4444' : 'primary.main'}
          >
            {totalH}s
          </Typography>
          {overWeekly && (
            <Chip label="aşıldı" size="small" color="error" variant="outlined"
              sx={{ height: 14, fontSize: '0.58rem', '& .MuiChip-label': { px: 0.5 } }} />
          )}
        </Box>
      </Tooltip>

      {/* Dinlenme ihlali */}
      {hasRestViolation && (
        <Tooltip
          title={<Box sx={{ whiteSpace: 'pre-line', fontSize: '0.72rem' }}>
            {`Min. dinlenme ihlali:\n${restTooltip}`}
          </Box>}
          placement="left"
          arrow
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, cursor: 'default' }}>
            <WarningAmberIcon sx={{ fontSize: 11, color: '#f97316' }} />
            <Typography variant="caption" color="#f97316" fontSize="0.65rem">
              {stats.restViolations.length}{compact ? '' : ' dinlenme ihlali'}
            </Typography>
          </Box>
        </Tooltip>
      )}

      {/* Haftalık progress bar */}
      <Box sx={{ width: '100%', height: 3, bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <Box sx={{
          height: '100%',
          width: `${Math.min(100, (stats.totalMins / (maxW * 60)) * 100)}%`,
          bgcolor: overWeekly ? '#ef4444' : '#14b8a6',
          borderRadius: 2,
          transition: 'width 0.3s',
        }} />
      </Box>
      <Typography variant="caption" color="text.disabled" fontSize={compact ? '0.55rem' : '0.58rem'}>
        {compact ? `/ ${maxW}s` : `net / ${maxW}s maks. · ${fmtHours(stats.totalBreakMins)} mola`}
      </Typography>
    </Box>
  )
}

// ─── Shift cell ───────────────────────────────────────────────
export function ShiftCell({
  assignment, isToday, isOnLeave, isRestDay, availStatus, dailyOver, onClick, readOnly, compact = false,
}: {
  assignment: ShiftAssignmentWithDetails | null
  isToday: boolean
  isOnLeave: boolean
  isRestDay: boolean
  availStatus: AvailStatus
  dailyOver: boolean
  dailyMins: number
  onClick: () => void
  readOnly?: boolean
  /** Dar ekran (mobil) — hücre ~64px genişliğe sığacak şekilde sadeleşir */
  compact?: boolean
}) {
  const cursor = readOnly ? 'default' : 'pointer'

  // ── Haftalık Tatil ──
  if (isRestDay) {
    return (
      <Tooltip title="Haftalık tatil — tıklayarak kaldırabilirsiniz" placement="top">
        <Box onClick={onClick} sx={{
          borderLeft: '2px solid rgba(99,102,241,0.5)',
          bgcolor: 'rgba(99,102,241,0.08)', p: 0.75, minHeight: 64, cursor,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.4,
          '&:hover': { bgcolor: readOnly ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.16)' },
        }}>
          <WeekendIcon sx={{ fontSize: 14, color: '#818cf8' }} />
          <Typography variant="caption" fontWeight={700} color="#818cf8" fontSize="0.7rem">Tatil</Typography>
        </Box>
      </Tooltip>
    )
  }

  // ── İzinli ──
  if (isOnLeave) {
    return (
      <Tooltip title={assignment
        ? `İzin onaylandı (${formatTime(assignment.start_time)}–${formatTime(assignment.end_time)})`
        : 'İzin onaylandı'} placement="top">
        <Box onClick={onClick} sx={{
          borderLeft: '1px solid', borderColor: 'divider',
          bgcolor: 'rgba(251,191,36,0.08)', p: 0.75, minHeight: 64, cursor,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.4,
          '&:hover': { bgcolor: readOnly ? 'rgba(251,191,36,0.08)' : 'rgba(251,191,36,0.14)' },
        }}>
          <EventBusyIcon sx={{ fontSize: 13, color: '#fbbf24' }} />
          <Typography variant="caption" fontWeight={700} color="warning.main" fontSize="0.7rem">İzinli</Typography>
          {assignment && !compact && (
            <Typography variant="caption" color="text.disabled" fontSize="0.6rem">
              {formatTime(assignment.start_time)}–{formatTime(assignment.end_time)}
            </Typography>
          )}
        </Box>
      </Tooltip>
    )
  }

  // Müsait değil (off day) — vardiya yok
  if (availStatus === 'off' && !assignment) {
    return (
      <Tooltip title="Çalışan bu gün müsait değil (off day)" placement="top">
        <Box onClick={onClick} sx={{
          borderLeft: '1px solid', borderColor: 'divider',
          bgcolor: 'rgba(239,68,68,0.08)', p: 0.75, minHeight: 64, cursor,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 0.4,
          '&:hover': { bgcolor: readOnly ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.14)' },
        }}>
          <Typography variant="caption" color="error.main" fontSize="0.65rem">Off</Typography>
          {!readOnly && <AddIcon sx={{ fontSize: 13, color: 'error.main', opacity: 0.5 }} />}
        </Box>
      </Tooltip>
    )
  }

  // Boş hücre (vardiya yok)
  if (!assignment) {
    // Availability durumuna göre arkaplan
    const bgColor =
      availStatus === 'full'
        ? isToday ? 'rgba(20,184,166,0.09)' : 'rgba(20,184,166,0.05)'
        : isToday ? 'rgba(20,184,166,0.03)' : 'transparent'
    const bgHoverColor =
      availStatus === 'full'
        ? 'rgba(20,184,166,0.13)'
        : 'rgba(20,184,166,0.08)'

    const tooltipAvail =
      availStatus === 'full' ? 'Çalışan bu gün müsait (availability kaydı var)' :
      availStatus === 'none' ? 'Availability kaydı yok' : undefined

    return (
      <Tooltip title={tooltipAvail} placement="top" disableHoverListener={!tooltipAvail}>
        <Box onClick={onClick} sx={{
          borderLeft: '2px solid',
          borderColor: availStatus === 'full' ? 'rgba(20,184,166,0.35)' : 'divider',
          bgcolor: bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: 64, cursor, position: 'relative',
          '&:hover': { bgcolor: readOnly ? bgColor : bgHoverColor, '& .add-icon': { opacity: readOnly ? 0 : 1 } },
        }}>
          {/* Availability nokta göstergesi */}
          {availStatus === 'full' && (
            <Box sx={{
              position: 'absolute', top: 5, right: 5,
              width: 5, height: 5, borderRadius: '50%',
              bgcolor: 'rgba(20,184,166,0.5)',
            }} />
          )}
          {!readOnly && (
            <AddIcon className="add-icon"
              sx={{ fontSize: 16, color: availStatus === 'full' ? 'primary.main' : 'text.disabled', opacity: 0, transition: 'opacity 0.15s' }} />
          )}
        </Box>
      </Tooltip>
    )
  }

  // Vardiya var
  const start = formatTime(assignment.start_time)
  const end = formatTime(assignment.end_time)
  const name = shiftDisplayName(assignment.shift_templates?.name, start, end)
  const grossMins = shiftDurationMins(assignment.start_time, assignment.end_time)
  const netMins = netWorkMins(assignment.start_time, assignment.end_time)
  const breakMins = grossMins - netMins

  // Renk: ihlal > partial availability > normal
  let bgBase = isToday ? 'rgba(20,184,166,0.05)' : 'rgba(99,102,241,0.05)'
  let bgHover = isToday ? 'rgba(20,184,166,0.1)' : 'rgba(99,102,241,0.12)'
  if (dailyOver) { bgBase = 'rgba(239,68,68,0.1)'; bgHover = 'rgba(239,68,68,0.16)' }
  else if (availStatus === 'off') { bgBase = 'rgba(239,68,68,0.1)'; bgHover = 'rgba(239,68,68,0.16)' }
  else if (availStatus === 'partial') { bgBase = 'rgba(234,179,8,0.08)'; bgHover = 'rgba(234,179,8,0.15)' }

  const tooltipText = [
    `${name}: ${start}–${end}`,
    `Brüt ${fmtHours(grossMins)} · Mola ${fmtHours(breakMins)} · Net ${fmtHours(netMins)}`,
    dailyOver ? '⚠️ Günlük maks. aşıldı' : '',
    availStatus === 'off' ? '⚠️ Müsait değil gün' : '',
    availStatus === 'partial' ? '⚠️ Müsaitlik penceresi dışı' : '',
  ].filter(Boolean).join('\n')

  const hasWarning = dailyOver || availStatus === 'off' || availStatus === 'partial'
  const warningColor = dailyOver || availStatus === 'off' ? '#ef4444' : '#eab308'

  return (
    <Tooltip title={<Box sx={{ whiteSpace: 'pre-line', fontSize: '0.75rem' }}>{tooltipText}</Box>} placement="top">
      <Box onClick={onClick} sx={{
        borderLeft: '1px solid', borderColor: 'divider',
        bgcolor: bgBase, p: compact ? 0.5 : 0.75, minHeight: 64, cursor, minWidth: 0,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.4,
        '&:hover': { bgcolor: readOnly ? bgBase : bgHover },
        // sol kenar rengi ihlal durumuna göre
        borderLeftColor: dailyOver || availStatus === 'off' ? 'rgba(239,68,68,0.5)'
          : availStatus === 'partial' ? 'rgba(234,179,8,0.5)'
          : 'divider',
        borderLeftWidth: (dailyOver || availStatus !== 'none') ? 2 : 1,
      }}>
        {compact ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
              <Typography variant="caption" fontWeight={700} color="secondary.main" fontSize="0.7rem" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {name}
              </Typography>
              {hasWarning && <WarningAmberIcon sx={{ fontSize: 10, flexShrink: 0, color: warningColor }} />}
            </Box>
            <Typography variant="caption" color="text.primary" fontSize="0.74rem" fontWeight={600} lineHeight={1.3} sx={{ fontVariantNumeric: "tabular-nums" }}>
              {start}<br />{end}
            </Typography>
            <Typography variant="caption" fontSize="0.66rem" fontWeight={700} color={dailyOver ? '#ef4444' : 'primary.main'}>
              {fmtHours(netMins)} net
            </Typography>
          </>
        ) : (<>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" fontWeight={700} color="secondary.main" fontSize="0.7rem" noWrap sx={{ flex: 1 }}>
            {name}
          </Typography>
          {hasWarning && <WarningAmberIcon sx={{ fontSize: 10, flexShrink: 0, color: warningColor }} />}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
          <AccessTimeIcon sx={{ fontSize: 10, color: 'text.disabled' }} />
          <Typography variant="caption" color="text.disabled" fontSize="0.65rem">
            {start}–{end}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="caption" fontSize="0.6rem" noWrap>
            <Box component="span" sx={{ color: dailyOver ? '#ef4444' : 'primary.main', fontWeight: 700 }}>
              {fmtHours(netMins)} net
            </Box>
            <Box component="span" sx={{ color: 'text.disabled' }}> · {fmtHours(breakMins)} mola</Box>
          </Typography>
          {!readOnly && <EditIcon sx={{ fontSize: 10, color: 'text.disabled' }} />}
        </Box>
        </>)}
      </Box>
    </Tooltip>
  )
}

