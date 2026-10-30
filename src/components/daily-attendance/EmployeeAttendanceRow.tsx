'use client'

/**
 * EmployeeAttendanceRow — günlük operasyon tablosunun mobil kartı (DataTable renderMobileItem).
 * Salt okunur: giriş / mola / çıkış yalnızca QR okutma ile işlenir.
 */
import { PersonAvatar } from '@/components/common'
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item'
import { AttendanceStatusChip } from './AttendanceStatusChip'
import { AttendanceTimeline } from './AttendanceTimeline'
import { BreakCell } from './BreakDetails'
import { ShiftTime } from './ShiftTime'
import { clock, formatDuration, type ShiftWindow } from './attendanceTime'
import type { DailyRow } from './dailyRows'

export function EmployeeAttendanceRow({ row, range, now }: { row: DailyRow; range: ShiftWindow | null; now: number }) {
  const rec = row.entry.attendanceRecord
  return (
    <Item variant="outline" size="sm" className="items-start">
      <ItemMedia><PersonAvatar name={row.name} size={32} /></ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full truncate">{row.name}</ItemTitle>
        <ItemDescription className="truncate">{row.role ?? '—'}</ItemDescription>
      </ItemContent>
      <ItemActions><AttendanceStatusChip status={row.status} /></ItemActions>
      <ItemFooter className="flex-col items-stretch gap-2 pl-10.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <ShiftTime start={row.start} end={row.end} />
          {rec?.clock_in_at && (
            <span className="text-muted-foreground tabular-nums">
              {clock(rec.clock_in_at)}–{rec.clock_out_at ? clock(rec.clock_out_at) : '…'}
            </span>
          )}
          {row.late !== null && <span className="text-warning">+{row.late} dk</span>}
          <BreakCell breaks={row.breaks} now={now} variant="inline" />
          {row.worked !== null && <span className="ml-auto font-medium tabular-nums">{formatDuration(row.worked)}</span>}
        </div>
        {range && <AttendanceTimeline segments={row.segments} range={range} now={now} label={row.summary} />}
      </ItemFooter>
    </Item>
  )
}
