'use client'

/**
 * EmployeeAttendanceRow — günlük operasyon tablosunun mobil kartı (DataTable renderMobileItem).
 * Salt okunur: giriş / mola / çıkış yalnızca QR okutma ile işlenir.
 */
import { PersonAvatar, StatusBadge } from '@/components/common'
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item'
import { AttendanceStatusChip } from './AttendanceStatusChip'
import { AttendanceTimeline } from './AttendanceTimeline'
import { BreakCell } from './BreakDetails'
import { PlanActualLines } from './PlanActualLines'
import { formatDelay, formatDuration, type ShiftWindow } from './attendanceTime'
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
        {/* Sabit yapı: solda etiketli plan / fiili satırları, sağda net süre (veri olmasa da "—") */}
        <div className="flex items-start justify-between gap-3">
          <PlanActualLines start={row.start} end={row.end} clockIn={rec?.clock_in_at} clockOut={rec?.clock_out_at} />
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-xs text-muted-foreground">Net</span>
            <span className="text-sm font-medium tabular-nums">{row.worked !== null ? formatDuration(row.worked) : '—'}</span>
          </div>
        </div>
        {(row.late !== null || row.breaks.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {row.late !== null && <StatusBadge tone="warning" label={`${formatDelay(row.late)} geç`} />}
            <BreakCell breaks={row.breaks} now={row.now} variant="badge" />
          </div>
        )}
        {range && <AttendanceTimeline segments={row.segments} range={range} now={now} label={row.summary} />}
      </ItemFooter>
    </Item>
  )
}
