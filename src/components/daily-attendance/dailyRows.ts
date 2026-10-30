/**
 * dailyRows — /api/attendance/daily kayıtlarını tablo satırına çevirir (yalnızca görünüm).
 */
import type { DailyShiftEntry } from '@/types/attendance'
import { roleNameOf } from '@/lib/roleJoin'
import { listBreaks, type BreakItem } from '@/lib/attendanceDurations'
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
  /** Günün molaları sırayla (son öğe sürüyor olabilir) */
  breaks: BreakItem[]
  /** Satırın "şimdi"si: bugün gerçek an, geçmiş günde vardiya bitişi (süren mola / çizelge orada durur) */
  now: number
  /** Zaman çizelgesinin ekran okuyucu metni */
  summary: string
}

/**
 * past: geçmiş bir gün gösteriliyor. O gün açık kalmış kayıt (çıkış okutulmamış) "Çıkış yok" olur;
 * net süresi bilinmez (—), çizelgesi ve süren molası vardiya bitişinde durur.
 */
export function buildDailyRows(entries: DailyShiftEntry[], now: number, { past = false }: { past?: boolean } = {}): DailyRow[] {
  return entries.map((entry) => {
    const { employee, shiftAssignment: sa, attendanceRecord: rec } = entry
    const win = shiftWindow(sa.work_date, sa.start_time, sa.end_time)
    const rowNow = past ? Math.max(win.end, win.start + 31 * 60_000) : now
    const liveStatus = dayStatusOf(rec?.status, win, rowNow, sa.is_on_leave)
    const status: DayStatus = past && (liveStatus === 'working' || liveStatus === 'on_break') ? 'no_out' : liveStatus
    const breaks = rec ? listBreaks(rec) : []
    const parts = [
      rec?.clock_in_at && `giriş ${clock(rec.clock_in_at)}`,
      ...breaks.map((b, i) => b.start_at
        ? `${breaks[0].start_at ? `${i + 1}. mola` : 'son mola'} ${clock(b.start_at)}–${b.end_at ? clock(b.end_at) : 'sürüyor'}`
        : `önceki molalar ${b.minutes} dk`),
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
      worked: status === 'no_out' ? null : workedMinutes(rec, rowNow, sa),
      segments: timelineSegments(win, rec, liveStatus, rowNow),
      breaks,
      now: rowNow,
      summary: `Vardiya ${sa.start_time.slice(0, 5)}–${sa.end_time.slice(0, 5)}${parts.length ? `, ${parts.join(', ')}` : ', okutma yok'}`,
    }
  })
}

/** Çizelge ekseni için tüm anlar (vardiyalar ve okutmalar) */
export function rowPoints(rows: DailyRow[]): number[] {
  return rows.flatMap((r) => r.segments.flatMap((s) => [s.from, s.to]))
}
