'use client'

/**
 * MobileScheduleView — haftalık planın mobil (kart) görünümü.
 */
import { useMemo } from 'react'
import {
  Box,
  Typography,
  Alert,
  Divider,
  Paper,
  Chip,
  Stack,
} from '@mui/material'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { EmployeeWithRole } from '@/types/employee'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails, WeeklyScheduleEntry } from '@/types/schedule'
import type { EmployeeAvailability } from '@/types/workforce'
import type { PublicHoliday } from '@/types/holiday'
import { formatTime } from '@/types/shiftTemplate'
import { netWorkMins } from '@/lib/workingTimeService'
import { PART_TIME_RULES } from '@/types/employee'
import { getWorkingTimeConfig } from '@/lib/workingTimeConfig'
import { WeekNavigator } from './WeekNavigator'
import { ShiftAssignDialog } from './ShiftAssignDialog'
import type { ShiftSavePayload } from './ShiftAssignDialog'
import { PageHeader, ListSkeleton } from '@/components/common'
import { format } from 'date-fns'

import { DAY_LABELS, fmtHours, breakMinsOf, shiftDisplayName, AvailabilityMap, calcEmployeeStats, getAvailStatus } from './scheduleHelpers'

// ─── Mobile view ──────────────────────────────────────────────
export interface MobileViewProps {
  holidayMap: Map<string, PublicHoliday>
  scheduleEntries: WeeklyScheduleEntry[]
  weekDays: string[]
  loading: boolean
  error: string | null
  currentWeek: Date
  onWeekChange: (d: Date) => void
  onCellClick: (emp: EmployeeWithRole, date: string) => void
  approvedLeaveMap: Set<string>
  availabilityMap: AvailabilityMap
  dialogOpen: boolean
  dialogEmployee: EmployeeWithRole | null
  dialogDate: string
  dialogExisting: ShiftAssignmentWithDetails | null
  dialogAvailability: EmployeeAvailability[]
  templates: ShiftTemplate[]
  saving: boolean
  onSave: (payload: ShiftSavePayload) => Promise<void>
  onDelete: () => Promise<void>
  onDialogClose: () => void
  readOnly?: boolean
}

export function MobileScheduleView({
  scheduleEntries, weekDays, loading, error, currentWeek, onWeekChange,
  onCellClick, approvedLeaveMap, availabilityMap, holidayMap,
  dialogOpen, dialogEmployee, dialogDate, dialogExisting, dialogAvailability,
  templates, saving, onSave, onDelete, onDialogClose, readOnly = false,
}: MobileViewProps) {
  const config = useMemo(() => getWorkingTimeConfig(), [])

  return (
    <Box sx={{ p: 2, minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary' }}>
      <PageHeader
        icon={CalendarMonthIcon}
        overline="Planlama"
        title="Haftalık Plan"
        actions={<WeekNavigator currentWeek={currentWeek} onChange={onWeekChange} />}
      />
      <Divider sx={{ mb: 2, borderColor: 'rgba(255,255,255,0.08)' }} />

      {loading && <ListSkeleton count={5} lines={3} actions={1} />}
      {error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && scheduleEntries.map((entry) => {
        const empAssignments = entry.employee
          ? Object.values(entry.dayAssignments).filter(Boolean) as ShiftAssignmentWithDetails[]
          : []
        const stats = calcEmployeeStats(empAssignments, weekDays, entry.employee.employment_type ?? 'full_time')
        const totalH = Math.round(stats.totalMins / 60 * 10) / 10
        const maxW = entry.employee.employment_type === 'part_time'
          ? PART_TIME_RULES.maxWeeklyHours
          : config.maxWeeklyWorkHours
        const overWeekly = stats.totalMins > maxW * 60

        return (
          <Paper key={entry.employee.id} elevation={0}
            sx={{ mb: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5, bgcolor: 'rgba(15,23,42,0.8)', borderBottom: '1px solid', borderColor: 'divider',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                  <Typography variant="subtitle2" fontWeight={700}>{entry.employee.full_name}</Typography>
                  {entry.employee.employment_type === 'part_time' && (
                    <Typography
                      component="span"
                      sx={{
                        fontSize: '0.55rem', fontWeight: 700,
                        color: '#818cf8', flexShrink: 0,
                        border: '1px solid rgba(129,140,248,0.4)',
                        borderRadius: '3px', px: '3px', lineHeight: '14px',
                      }}
                    >
                      PT
                    </Typography>
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary">{entry.employee.role}</Typography>
              </Box>
              <Typography variant="caption" fontWeight={700} color={overWeekly ? 'error.main' : 'primary.main'}>
                {totalH}s / {maxW}s
              </Typography>
            </Box>

            <Stack spacing={0}>
              {weekDays.map((d, i) => {
                const asgn = entry.dayAssignments[d]
                const isToday = d === format(new Date(), 'yyyy-MM-dd')
                const isOnLeave = asgn?.is_on_leave === true || approvedLeaveMap.has(`${entry.employee.id}:${d}`)
                const availStatus = getAvailStatus(entry.employee.id, d, availabilityMap, asgn?.start_time, asgn?.end_time)

                return (
                  <Box key={d} onClick={() => onCellClick(entry.employee, d)}
                    sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      px: 2, py: 1.25, minHeight: 44,
                      borderBottom: i < 6 ? '1px solid' : 'none', borderColor: 'divider',
                      bgcolor: isOnLeave ? 'rgba(251,191,36,0.04)'
                        : availStatus === 'off' && !asgn ? 'rgba(239,68,68,0.06)'
                        : availStatus === 'full' && !asgn ? 'rgba(20,184,166,0.05)'
                        : isToday ? 'rgba(20,184,166,0.04)' : 'transparent',
                      cursor: readOnly ? 'default' : 'pointer', WebkitTapHighlightColor: 'transparent',
                      '&:active': { bgcolor: readOnly ? 'transparent' : 'rgba(255,255,255,0.06)' },
                    }}>
                    <Typography variant="caption" fontWeight={isToday ? 700 : 400}
                      color={holidayMap.get(d) && !holidayMap.get(d)!.half_day ? '#eab308' : isToday ? 'primary.main' : 'text.secondary'}
                      title={holidayMap.get(d)?.name}
                      sx={{ width: 32 }}>
                      {DAY_LABELS[i]}{holidayMap.get(d) && !holidayMap.get(d)!.half_day ? ' RT' : ''}
                    </Typography>

                    {isOnLeave ? (
                      <Chip label="İzinli" size="small" sx={{ height: 18, fontSize: '0.62rem',
                        bgcolor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }} />
                    ) : asgn ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        {(availStatus === 'off' || availStatus === 'partial') && (
                          <WarningAmberIcon sx={{ fontSize: 12, color: availStatus === 'off' ? '#ef4444' : '#eab308' }} />
                        )}
                        <Chip label={shiftDisplayName(asgn.shift_templates?.name, asgn.start_time, asgn.end_time)} size="small"
                          sx={{ height: 18, fontSize: '0.62rem',
                            bgcolor: 'rgba(99,102,241,0.15)', color: '#818cf8' }} />
                        <Typography variant="caption" color="text.disabled" fontSize="0.65rem">
                          {formatTime(asgn.start_time)}–{formatTime(asgn.end_time)}
                          {' '}({fmtHours(netWorkMins(asgn.start_time, asgn.end_time))} net · {fmtHours(breakMinsOf(asgn.start_time, asgn.end_time))} mola)
                        </Typography>
                      </Box>
                    ) : availStatus === 'off' ? (
                      <Typography variant="caption" color="error.main" fontSize="0.65rem">Off gün</Typography>
                    ) : availStatus === 'full' ? (
                      <Typography variant="caption" sx={{ color: 'rgba(20,184,166,0.6)', fontSize: '0.65rem' }}>Müsait</Typography>
                    ) : (
                      <Typography variant="caption" color="text.disabled">—</Typography>
                    )}

                    {!readOnly && (asgn
                      ? <EditIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                      : <AddIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                    )}
                  </Box>
                )
              })}
            </Stack>
          </Paper>
        )
      })}

      {!readOnly && (
        <ShiftAssignDialog
          key={`${dialogEmployee?.id ?? ''}:${dialogDate}:${dialogExisting?.id ?? 'new'}`}
          open={dialogOpen}
          onClose={onDialogClose}
          onSave={onSave}
          onDelete={dialogExisting ? onDelete : undefined}
          employee={dialogEmployee}
          workDate={dialogDate}
          templates={templates}
          existingAssignment={dialogExisting}
          loading={saving}
          dayAvailability={dialogAvailability}
        />
      )}
    </Box>
  )
}

