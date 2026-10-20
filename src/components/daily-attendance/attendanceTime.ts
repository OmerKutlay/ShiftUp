/**
 * attendanceTime — Günlük operasyon ve Genel bakış için yalnızca görünüm hesapları:
 * vardiya penceresi, anlık durum (gelmedi / gecikiyor / başlamadı), net süre ve zaman çizelgesi
 * parçaları. Veri değiştirmez; API'den gelen kaydı ve "şimdi"yi yorumlar.
 *
 * Vardiya saatleri (TIME) Türkiye yerel saatidir; Türkiye 2016'dan beri sabit UTC+3
 * (bkz. lib/attendanceAlerts getShiftWindow — sunucu bağımlılıkları yüzünden burada kopyası var).
 */
'use client'

import { useEffect, useState } from 'react'
import type { BadgeTone } from '@/components/common'
import type { AttendanceRecord, AttendanceStatus } from '@/types/attendance'

const TURKEY_UTC_OFFSET = '+03:00'
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/** Giriş bu kadar dakika gecikirse "geç" sayılır (attendanceAlerts.lateToleranceMins varsayılanı) */
export const LATE_TOLERANCE_MINS = 15
/** Vardiya başlangıcından bu kadar sonra giriş yoksa "gelmedi" (attendanceAlerts.missedClockInMins) */
export const MISSED_CLOCK_IN_MINS = 30

export interface ShiftWindow {
  start: number
  end: number
}

export function shiftWindow(workDate: string, startTime: string, endTime: string): ShiftWindow {
  const start = new Date(`${workDate}T${startTime.slice(0, 5)}:00${TURKEY_UTC_OFFSET}`).getTime()
  let end = new Date(`${workDate}T${endTime.slice(0, 5)}:00${TURKEY_UTC_OFFSET}`).getTime()
  if (end <= start) end += DAY_MS
  return { start, end }
}

/** Bugünün Türkiye tarihi (YYYY-MM-DD) — verilen ana göre */
export function turkeyDate(now: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now))
}

const timeFmt = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
})

export function clock(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : timeFmt.format(d)
}

export const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null)

/** "7s 30d" (DESIGN_GUIDE §6) */
export function formatDuration(mins: number | null): string {
  if (mins === null) return '—'
  const m = Math.max(0, Math.round(mins))
  return `${Math.floor(m / 60)}s ${m % 60}d`
}

/** "45 dk", "1 sa 10 dk" */
export function formatDelay(mins: number): string {
  if (mins < 60) return `${mins} dk`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`
}

// ─── Anlık durum ─────────────────────────────────────────────

export type DayStatus = 'upcoming' | 'late' | 'absent' | 'working' | 'on_break' | 'done' | 'leave'

export const DAY_STATUS: Record<DayStatus, { label: string; tone: BadgeTone; order: number }> = {
  absent: { label: 'Gelmedi', tone: 'danger', order: 0 },
  late: { label: 'Gecikiyor', tone: 'warning', order: 1 },
  on_break: { label: 'Molada', tone: 'warning', order: 2 },
  working: { label: 'Çalışıyor', tone: 'success', order: 3 },
  upcoming: { label: 'Başlamadı', tone: 'neutral', order: 4 },
  done: { label: 'Çıkış yaptı', tone: 'plum', order: 5 },
  leave: { label: 'İzinli', tone: 'info', order: 6 },
}

/**
 * Kayıt durumu + vardiya saati + şimdi → ekranda gösterilecek durum.
 * Giriş okutulmamışsa: başlamadan önce "Başlamadı", ilk 30 dk "Gecikiyor", sonra "Gelmedi".
 */
export function dayStatusOf(
  status: AttendanceStatus | string | null | undefined,
  win: ShiftWindow,
  now: number,
  onLeave = false,
): DayStatus {
  switch (status) {
    case 'working':
    case 'working_after_break':
      return 'working'
    case 'on_break':
      return 'on_break'
    case 'clocked_out':
      return 'done'
  }
  if (onLeave) return 'leave'
  if (now < win.start) return 'upcoming'
  if (now < win.start + MISSED_CLOCK_IN_MINS * MINUTE_MS) return 'late'
  return 'absent'
}

/** Girişin vardiya başlangıcına göre gecikmesi (dk); tolerans altındaysa null */
export function lateMinutes(clockInAt: string | null | undefined, win: ShiftWindow): number | null {
  const t = ms(clockInAt)
  if (t === null) return null
  const mins = Math.floor((t - win.start) / MINUTE_MS)
  return mins >= LATE_TOLERANCE_MINS ? mins : null
}

/**
 * Net çalışma (dk): giriş → çıkış (ya da şimdi), molalar düşülür.
 * Çıkış yapıldıysa planlanan mola ile fiili moladan büyüğü düşülür (mola okutmayan mola yapmış sayılır);
 * vardiya sürerken yalnızca fiili mola düşülür.
 */
export function workedMinutes(rec: AttendanceRecord | null, now: number, plannedBreakMins = 0): number | null {
  const inAt = ms(rec?.clock_in_at)
  if (!rec || inAt === null) return null
  const clockOut = ms(rec.clock_out_at)
  const outAt = clockOut ?? now
  const bStart = ms(rec.break_start_at)
  const bEnd = ms(rec.break_end_at) ?? (rec.status === 'on_break' ? now : null)
  const lastBreak = bStart !== null && bEnd !== null ? Math.max(0, bEnd - bStart) / MINUTE_MS : 0
  const actualBreak = (rec.completed_break_minutes ?? 0) + lastBreak
  const breakMins = clockOut !== null ? Math.max(plannedBreakMins, actualBreak) : actualBreak
  return Math.max(0, (outAt - inAt) / MINUTE_MS - breakMins)
}

// ─── Zaman çizelgesi ─────────────────────────────────────────

export type SegmentKind = 'planned' | 'worked' | 'break' | 'missed' | 'leave'

export interface Segment {
  kind: SegmentKind
  from: number
  to: number
}

/** Bir vardiyanın çizelge parçaları: plan (zemin) + çalışılan / mola / kaçırılan */
export function timelineSegments(
  win: ShiftWindow,
  rec: Pick<AttendanceRecord, 'status' | 'clock_in_at' | 'clock_out_at'> &
    Partial<Pick<AttendanceRecord, 'break_start_at' | 'break_end_at'>> | null,
  status: DayStatus,
  now: number,
): Segment[] {
  const segs: Segment[] = [{ kind: status === 'leave' ? 'leave' : 'planned', from: win.start, to: win.end }]
  const inAt = ms(rec?.clock_in_at)
  if (rec && inAt !== null) {
    const outAt = ms(rec.clock_out_at) ?? Math.max(inAt, now)
    const bStart = ms(rec.break_start_at)
    const bEnd = ms(rec.break_end_at) ?? (rec.status === 'on_break' ? outAt : null)
    if (bStart !== null && bEnd !== null && bStart >= inAt) {
      segs.push({ kind: 'worked', from: inAt, to: bStart })
      segs.push({ kind: 'break', from: bStart, to: bEnd })
      if (bEnd < outAt) segs.push({ kind: 'worked', from: bEnd, to: outAt })
    } else {
      segs.push({ kind: 'worked', from: inAt, to: outAt })
    }
  } else if (status === 'late' || status === 'absent') {
    segs.push({ kind: 'missed', from: win.start, to: Math.min(now, win.end) })
  }
  return segs
}

/** Çizelge ekseni: tüm vardiya ve okutmaları kapsayan, tam saate yuvarlanmış aralık */
export function timelineRange(points: number[]): ShiftWindow | null {
  const valid = points.filter((p) => Number.isFinite(p))
  if (valid.length === 0) return null
  const hour = 60 * MINUTE_MS
  const start = Math.floor(Math.min(...valid) / hour) * hour
  const end = Math.ceil(Math.max(...valid) / hour) * hour
  return { start, end: Math.max(end, start + hour) }
}

/** Dakikada bir güncellenen "şimdi" — gecikme, süre ve çizelge canlı kalsın */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
