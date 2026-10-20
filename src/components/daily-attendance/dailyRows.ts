/**
 * dailyRows — /api/attendance/daily kayıtlarını tablo satırına çevirir (yalnızca görünüm).
 */
import type { DailyShiftEntry } from '@/types/attendance'
import { roleNameOf } from '@/lib/roleJoin'
import { plannedBreakMins } from '@/lib/workingTimeService'
import {
  clock, dayStatusOf, lateMinutes, timelineSegments, workedMinutes,
  type DayStatus, type Segment, type ShiftWindow, shiftWindow,
} from './attendanceTime'

export interface DailyRow {
  id: string
  entry: DailyShiftEntry
  name: string
  role: string | null
  start: string
  end: string
  win: ShiftWindow
  status: DayStatus
  /** Geç giriş (dk), tolerans altındaysa null */
  late: number | null
  worked: number | null
  segments: Segment[]
  /** Zaman çizelgesinin ekran okuyucu metni */
  summary: string
}

export function buildDailyRows(entries: DailyShiftEntry[], now: number): DailyRow[] {
  return entries.map((entry) => {
    const { employee, shiftAssignment: sa, attendanceRecord: rec } = entry
    const win = shiftWindow(sa.work_date, sa.start_time, sa.end_time)
    const status = dayStatusOf(rec?.status, win, now, sa.is_on_leave)
    const parts = [
      rec?.clock_in_at && `giriş ${clock(rec.clock_in_at)}`,
      rec?.break_start_at && `mola ${clock(rec.break_start_at)}–${rec.break_end_at ? clock(rec.break_end_at) : 'sürüyor'}`,
      rec?.clock_out_at && `çıkış ${clock(rec.clock_out_at)}`,
    ].filter(Boolean)
    return {
      id: sa.id,
      entry,
      name: employee.full_name,
      role: roleNameOf(employee),
      start: sa.start_time.slice(0, 5),
      end: sa.end_time.slice(0, 5),
      win,
      status,
      late: lateMinutes(rec?.clock_in_at, win),
      worked: workedMinutes(rec, now, plannedBreakMins(sa.start_time, sa.end_time)),
      segments: timelineSegments(win, rec, status, now),
      summary: `Vardiya ${sa.start_time.slice(0, 5)}–${sa.end_time.slice(0, 5)}${parts.length ? `, ${parts.join(', ')}` : ', okutma yok'}`,
    }
  })
}

/** Çizelge ekseni için tüm anlar (vardiyalar ve okutmalar) */
export function rowPoints(rows: DailyRow[]): number[] {
  return rows.flatMap((r) => r.segments.flatMap((s) => [s.from, s.to]))
}
