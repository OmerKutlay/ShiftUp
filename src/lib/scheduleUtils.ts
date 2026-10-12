/**
 * scheduleUtils — haftalık plan için saf (DB'siz) yardımcılar.
 * Hem client bileşenlerinde hem server repository'lerinde kullanılır.
 */
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns'

/** Haftanın Pazartesi–Pazar tarih aralığını döner */
export function getWeekRange(date: Date): { start: Date; end: Date } {
  const start = startOfWeek(date, { weekStartsOn: 1 }) // Pazartesi
  const end = endOfWeek(date, { weekStartsOn: 1 })     // Pazar
  return { start, end }
}

/** ISO date string listesi (Pazartesi–Pazar) */
export function getWeekDays(date: Date): string[] {
  const { start } = getWeekRange(date)
  return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
}

/**
 * Zaman aralığı çakışma kontrolü.
 * İki vardiya start/end zamanları overlap ediyor mu?
 * 'HH:MM' veya 'HH:MM:SS' formatını kabul eder.
 */
export function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  // Dakikaya çevir
  const toMins = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const aS = toMins(aStart)
  let aE = toMins(aEnd)
  const bS = toMins(bStart)
  let bE = toMins(bEnd)

  // Gece yarısını geçen vardiyalar (end < start)
  if (aE <= aS) aE += 24 * 60
  if (bE <= bS) bE += 24 * 60

  // Overlap: A başlamadan B bitiyor veya B başlamadan A bitiyor değilse
  return aS < bE && bS < aE
}

/** Vardiyayı mutlak dakika aralığına çevirir (gece yarısını geçenler için +24s) */
export function shiftAbsoluteRange(workDate: string, startTime: string, endTime: string): [number, number] {
  const toMins = (t: string) => {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }
  const day = Math.round(Date.UTC(
    Number(workDate.slice(0, 4)), Number(workDate.slice(5, 7)) - 1, Number(workDate.slice(8, 10))
  ) / 60000)
  const s = toMins(startTime)
  let e = toMins(endTime)
  if (e <= s) e += 24 * 60
  return [day + s, day + e]
}
