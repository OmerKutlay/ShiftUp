'use client'

import { Chip } from '@mui/material'
import type { AttendanceStatus as AttendanceStatusType } from '@/types/attendance'
import { ATTENDANCE_STATUS_LABELS } from '@/types/attendance'
import { C, tint } from '@/lib/palette'

interface Props {
  status: AttendanceStatusType
}

const STATUS_STYLES: Record<
  AttendanceStatusType,
  { bgcolor: string; color: string; borderColor: string }
> = {
  shift_waiting: {
    bgcolor: tint(C.neutral, 0.15),
    color: C.inkMuted,
    borderColor: tint(C.neutral, 0.3),
  },
  working: {
    bgcolor: tint(C.success, 0.15),
    color: C.success,
    borderColor: tint(C.success, 0.3),
  },
  on_break: {
    bgcolor: tint(C.warning, 0.15),
    color: C.warning,
    borderColor: tint(C.warning, 0.3),
  },
  working_after_break: {
    bgcolor: tint(C.success, 0.15),
    color: C.success,
    borderColor: tint(C.success, 0.3),
  },
  clocked_out: {
    bgcolor: tint(C.plum, 0.15),
    color: C.plum,
    borderColor: tint(C.plum, 0.3),
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
