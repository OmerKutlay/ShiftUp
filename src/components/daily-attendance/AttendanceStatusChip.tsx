'use client'

import type { AttendanceStatus as AttendanceStatusType } from '@/types/attendance'
import { ATTENDANCE_STATUS_LABELS } from '@/types/attendance'
import { StatusBadge, type BadgeTone } from '@/components/common'

interface Props {
  status: AttendanceStatusType
}

const STATUS_TONES: Record<AttendanceStatusType, BadgeTone> = {
  shift_waiting: 'neutral',
  working: 'success',
  on_break: 'warning',
  working_after_break: 'success',
  clocked_out: 'plum',
}

export function AttendanceStatusChip({ status }: Props) {
  const label = ATTENDANCE_STATUS_LABELS[status]
  // Moladan dönen çalışanı "Çalışıyor"dan ayırt et
  const displayLabel = status === 'working_after_break' ? `${label} (moladan döndü)` : label
  return <StatusBadge tone={STATUS_TONES[status]} label={displayLabel} />
}
