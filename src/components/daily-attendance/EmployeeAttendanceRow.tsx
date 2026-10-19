'use client'

import { Box, Typography } from '@mui/material'
import type { DailyShiftEntry, AttendanceRecord } from '@/types/attendance'
import { AttendanceStatusChip } from './AttendanceStatusChip'
import { formatInTimeZone } from '@/lib/dateUtils'
import { PersonAvatar, SectionRow } from '@/components/common'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import { C, SHIFT_KIND_TONES } from '@/lib/palette'

interface Props {
  entry: DailyShiftEntry
}

/** Salt okunur satır — giriş / mola / çıkış yalnızca QR okutma ile işlenir. */
export function EmployeeAttendanceRow({ entry }: Props) {
  const { employee, shiftAssignment, attendanceRecord } = entry
  const currentStatus = attendanceRecord?.status ?? 'shift_waiting'
  const start = shiftAssignment.start_time.slice(0, 5)
  const end = shiftAssignment.end_time.slice(0, 5)
  const tone = SHIFT_KIND_TONES[shiftKindOf(undefined, start, end)]

  return (
    <SectionRow sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: '1 1 220px', minWidth: 0 }}>
        <PersonAvatar name={employee.full_name} size={36} />
        <Box sx={{ minWidth: 0 }}>
          <Typography fontSize="0.875rem" fontWeight={700} noWrap>{employee.full_name}</Typography>
          <Typography fontSize="0.72rem" color="text.secondary" noWrap>{employee.role}</Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', flex: '2 1 320px', minWidth: 0 }}>
        <Typography
          fontSize="0.78rem" fontWeight={700}
          sx={{ color: tone.text, bgcolor: tone.soft, px: 1, py: 0.5, borderRadius: '8px', fontVariantNumeric: 'tabular-nums' }}
        >
          {start} – {end}
        </Typography>
        <TimeInfo attendanceRecord={attendanceRecord} />
        <Box sx={{ flex: 1 }} />
        <AttendanceStatusChip status={currentStatus} />
      </Box>
    </SectionRow>
  )
}

// ---------------------------------------------------------------
// Sub-component: giriş / mola / çıkış saatleri
// ---------------------------------------------------------------
function TimeInfo({ attendanceRecord }: { attendanceRecord: AttendanceRecord | null }) {
  if (!attendanceRecord) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25 }}>
      {attendanceRecord.clock_in_at && <TimeField label="Giriş" value={attendanceRecord.clock_in_at} color={C.success} />}
      {attendanceRecord.break_start_at && <TimeField label="Mola" value={attendanceRecord.break_start_at} color={C.warning} />}
      {attendanceRecord.break_end_at && <TimeField label="Dönüş" value={attendanceRecord.break_end_at} color={C.info} />}
      {attendanceRecord.clock_out_at && <TimeField label="Çıkış" value={attendanceRecord.clock_out_at} color={C.plum} />}
    </Box>
  )
}

function TimeField({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Typography fontSize="0.75rem" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      <Box component="span" sx={{ color, fontWeight: 600 }}>{label}: </Box>
      {formatInTimeZone(value)}
    </Typography>
  )
}
