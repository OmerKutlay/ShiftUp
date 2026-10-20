'use client'

import type { DailyShiftEntry, AttendanceRecord } from '@/types/attendance'
import { AttendanceStatusChip } from './AttendanceStatusChip'
import { formatInTimeZone } from '@/lib/dateUtils'
import { PersonAvatar, SectionRow } from '@/components/common'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { roleNameOf } from '@/lib/roleJoin'

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
    <SectionRow className="flex-wrap gap-y-2">
      <div className="flex min-w-0 flex-[1_1_220px] items-center gap-2.5">
        <PersonAvatar name={employee.full_name} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{employee.full_name}</p>
          <p className="truncate text-xs text-ink-secondary">{roleNameOf(employee)}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-[2_1_320px] flex-wrap items-center gap-3">
        <span className="rounded-lg px-2 py-1 text-[0.78rem] font-bold tabular-nums" style={{ color: tone.text, backgroundColor: tone.soft }}>
          {start} – {end}
        </span>
        <TimeInfo attendanceRecord={attendanceRecord} />
        <span className="flex-1" />
        <AttendanceStatusChip status={currentStatus} />
      </div>
    </SectionRow>
  )
}

/** Giriş / mola / çıkış saatleri */
function TimeInfo({ attendanceRecord }: { attendanceRecord: AttendanceRecord | null }) {
  if (!attendanceRecord) return null
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      {attendanceRecord.clock_in_at && <TimeField label="Giriş" value={attendanceRecord.clock_in_at} className="text-success" />}
      {attendanceRecord.break_start_at && <TimeField label="Mola" value={attendanceRecord.break_start_at} className="text-warning" />}
      {attendanceRecord.break_end_at && <TimeField label="Dönüş" value={attendanceRecord.break_end_at} className="text-info" />}
      {attendanceRecord.clock_out_at && <TimeField label="Çıkış" value={attendanceRecord.clock_out_at} className="text-plum" />}
    </div>
  )
}

function TimeField({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <span className="text-xs text-ink-secondary tabular-nums">
      <span className={`font-semibold ${className}`}>{label}: </span>
      {formatInTimeZone(value)}
    </span>
  )
}
