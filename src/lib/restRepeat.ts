/**
 * restRepeat — tekrarlayan haftalık tatilin süresi (istemci + sunucu, saf).
 *
 * Süre: süresiz (null), N hafta (N tekrar) ya da N ay (başlangıçtan N ay sonrasının bir gün öncesine kadar).
 * Sunucu yalnızca bitiş gününü (recurring_until, dahil) alır; kural o günden sonra tekrar üretmez.
 */
import { addDaysToDateString } from './dateUtils'

export type RestRepeat = { unit: 'week' | 'month'; count: number } | null

/** Elle girilen hafta sayısı sınırları (2 hafta – 2 yıl) */
export const MIN_REPEAT_WEEKS = 2
export const MAX_REPEAT_WEEKS = 104
/** Sunucu: bitiş günü başlangıçtan en fazla bu kadar gün sonra olabilir */
export const MAX_REPEAT_DAYS = 731

export const REST_REPEAT_PRESETS: ReadonlyArray<{ key: string; label: string; repeat: RestRepeat }> = [
  { key: 'none', label: 'Süresiz', repeat: null },
  { key: '1m', label: '1 ay', repeat: { unit: 'month', count: 1 } },
  { key: '3m', label: '3 ay', repeat: { unit: 'month', count: 3 } },
  { key: '6m', label: '6 ay', repeat: { unit: 'month', count: 6 } },
  { key: '12m', label: '1 yıl', repeat: { unit: 'month', count: 12 } },
]

/** 'YYYY-MM-DD' + n ay; ay sonu taşmaz (31 Ocak + 1 ay → 28/29 Şubat) */
function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + n, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

/** Kuralın son günü (dahil); süresizde null */
export function repeatUntil(start: string, repeat: RestRepeat): string | null {
  if (!repeat) return null
  if (repeat.unit === 'week') return addDaysToDateString(start, (repeat.count - 1) * 7)
  return addDaysToDateString(addMonths(start, repeat.count), -1)
}

/** Başlangıç dahil, bitişe kadar kaç hafta tatil olur */
export function repeatOccurrences(start: string, until: string): number {
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
  return days < 0 ? 0 : Math.floor(days / 7) + 1
}

/** "Süresiz" · "3 ay" · "1 yıl" · "8 hafta" */
export function repeatLabel(repeat: RestRepeat): string {
  if (!repeat) return 'Süresiz'
  if (repeat.unit === 'week') return `${repeat.count} hafta`
  return repeat.count % 12 === 0 ? `${repeat.count / 12} yıl` : `${repeat.count} ay`
}

export const sameRepeat = (a: RestRepeat, b: RestRepeat): boolean =>
  a === b || (!!a && !!b && a.unit === b.unit && a.count === b.count)

export const isValidRepeatWeeks = (n: number): boolean =>
  Number.isInteger(n) && n >= MIN_REPEAT_WEEKS && n <= MAX_REPEAT_WEEKS
