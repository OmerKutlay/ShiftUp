/**
 * Kontrol listesi görünüm yardımcıları (saf).
 */
import { formatInTimeZone } from '@/lib/dateUtils'
import { isRunComplete, isRunOverdue } from '@/lib/checklistRules'
import type { ChecklistRun, TodayChecklistsResponse } from '@/types/checklist'

/** Pazartesi başlangıçlı gün sırası (değerler 0 = Pazar … 6 = Cumartesi) */
export const WEEKDAY_OPTIONS: { value: number; short: string; long: string }[] = [
  { value: 1, short: 'Pzt', long: 'Pazartesi' },
  { value: 2, short: 'Sal', long: 'Salı' },
  { value: 3, short: 'Çar', long: 'Çarşamba' },
  { value: 4, short: 'Per', long: 'Perşembe' },
  { value: 5, short: 'Cum', long: 'Cuma' },
  { value: 6, short: 'Cmt', long: 'Cumartesi' },
  { value: 0, short: 'Paz', long: 'Pazar' },
]

export function weekdaysLabel(days: number[]): string {
  if (days.length === 7) return 'Her gün'
  return WEEKDAY_OPTIONS.filter((d) => days.includes(d.value)).map((d) => d.short).join(', ')
}

export function progress(run: Pick<ChecklistRun, 'items'>): { done: number; total: number } {
  return { done: run.items.filter((i) => i.done_at).length, total: run.items.length }
}

export const clock = (iso: string | null): string => (iso ? formatInTimeZone(iso) : '—')

/**
 * Bir madde işaretlenince / geri alınınca bugünün listesini yerel olarak günceller (iyimser güncelleme).
 * Tamamlanma kuralı sunucudakiyle aynıdır (isRunComplete).
 */
export function applyItemToggle(
  data: TodayChecklistsResponse,
  runId: string,
  itemId: string,
  done: boolean,
  actor: { id: string; name: string },
  nowIso: string
): TodayChecklistsResponse {
  return {
    ...data,
    runs: data.runs.map((run) => {
      if (run.id !== runId) return run
      const items = run.items.map((i) =>
        i.id !== itemId ? i : done
          ? { ...i, done_at: nowIso, done_by: actor.id, done_by_name: actor.name }
          : { ...i, done_at: null, done_by: null, done_by_name: null }
      )
      const complete = isRunComplete(items)
      const completed_at = complete ? run.completed_at ?? nowIso : null
      return {
        ...run,
        items,
        completed_at,
        completed_by_name: complete ? run.completed_by_name ?? actor.name : null,
        overdue: isRunOverdue({ run_date: run.run_date, due_time: run.due_time, completed_at }, Date.parse(nowIso)),
      }
    }),
  }
}
