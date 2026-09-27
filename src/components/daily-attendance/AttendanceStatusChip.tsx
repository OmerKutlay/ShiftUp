'use client'

import { Chip } from '@mui/material'
import type { AttendanceStatus as AttendanceStatusType } from '@/types/attendance'
import { ATTENDANCE_STATUS_LABELS } from '@/types/attendance'

interface Props {
  status: AttendanceStatusType
}

const STATUS_STYLES: Record<
  AttendanceStatusType,
  { bgcolor: string; color: string; borderColor: string }
> = {
  shift_waiting: {
    bgcolor: 'rgba(100, 116, 139, 0.15)',
    color: '#94a3b8',
    borderColor: 'rgba(100, 116, 139, 0.3)',
  },
  working: {
    bgcolor: 'rgba(16, 185, 129, 0.15)',
    color: '#10b981',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  on_break: {
    bgcolor: 'rgba(245, 158, 11, 0.15)',
    color: '#f59e0b',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  working_after_break: {
    bgcolor: 'rgba(16, 185, 129, 0.15)',
    color: '#10b981',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  clocked_out: {
    bgcolor: 'rgba(99, 102, 241, 0.15)',
    color: '#818cf8',
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
}

export function AttendanceStatusChip({ status }: Props) {
  const style = STATUS_STYLES[status]
  const label = ATTENDANCE_STATUS_LABELS[status]

  // Add suffix for working_after_break to distinguish from working
  const displayLabel =
    status === 'working_after_break' ? `${label} (moladan döndü)` : label

  return (
    <Chip
      label={displayLabel}
      size="small"
      variant="outlined"
      sx={{
        bgcolor: style.bgcolor,
        color: style.color,
        borderColor: style.borderColor,
        fontWeight: 600,
        fontSize: '0.7rem',
        height: 24,
      }}
    />
  )
}
