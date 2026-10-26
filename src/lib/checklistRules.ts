/**
 * checklistRules — kontrol listesi iş kuralları (saf, test edilebilir).
 *
 * Aynı kurallar SQL tarafında (supabase/migrations/20261028150100_checklists.sql →
 * ensure_checklist_runs / scan_checklist_overdue) uygulanır; ikisi birlikte güncellenmeli.
 */
import { addDaysToDateString, dayOfWeekFromDateString } from '@/lib/dateUtils'
import { isValidTime } from '@/lib/validation'
import type { ChecklistKind, ChecklistTemplateInput } from '@/types/checklist'

export const CHECKLIST_KINDS: readonly ChecklistKind[] = ['opening', 'closing', 'custom']
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const
export const MAX_ITEM_TEXT = 200
export const MAX_ITEMS = 60
export const MAX_NAME = 80
export const MAX_NOTE = 500
/** Son saatten sonra yöneticiye haber vermeden önce tanınan süre */
export const OVERDUE_GRACE_MINS = 15

export class ChecklistValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChecklistValidationError'
  }
}

// ─── Şablon doğrulama ────────────────────────────────────────

/** İstemciden gelen şablon gövdesini doğrular ve normalize eder */
export function parseTemplateInput(body: unknown): ChecklistTemplateInput {
  const b = (body ?? {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) throw new ChecklistValidationError('Liste adı boş olamaz.')
  if (name.length > MAX_NAME) throw new ChecklistValidationError(`Liste adı en fazla ${MAX_NAME} karakter olabilir.`)

  const kind = b.kind
  if (typeof kind !== 'string' || !(CHECKLIST_KINDS as readonly string[]).includes(kind)) {
    throw new ChecklistValidationError('Geçersiz liste türü.')
  }

  let weekdays: number[] = [...ALL_WEEKDAYS]
  if (b.weekdays !== undefined) {
    if (!Array.isArray(b.weekdays) || !b.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      throw new ChecklistValidationError('Geçersiz gün seçimi.')
    }
    weekdays = [...new Set(b.weekdays as number[])].sort((x, y) => x - y)
    if (weekdays.length === 0) throw new ChecklistValidationError('En az bir gün seçin.')
  }

  let due_time: string | null = null
  if (b.due_time !== undefined && b.due_time !== null && b.due_time !== '') {
    if (!isValidTime(b.due_time)) throw new ChecklistValidationError('Geçersiz son saat (HH:MM bekleniyor).')
    due_time = (b.due_time as string).slice(0, 5)
  }

  if (b.active !== undefined && typeof b.active !== 'boolean') {
    throw new ChecklistValidationError('active alanı boolean olmalıdır.')
  }

  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new ChecklistValidationError('En az bir madde ekleyin.')
  }
  if (b.items.length > MAX_ITEMS) throw new ChecklistValidationError(`En fazla ${MAX_ITEMS} madde eklenebilir.`)
  const items = (b.items as unknown[]).map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>
    const text = typeof it.text === 'string' ? it.text.trim() : ''
    if (!text) throw new ChecklistValidationError('Madde metni boş olamaz.')
    if (text.length > MAX_ITEM_TEXT) {
      throw new ChecklistValidationError(`Madde metni en fazla ${MAX_ITEM_TEXT} karakter olabilir.`)
    }
    return { text, required: it.required === true }
  })

  return { name, kind: kind as ChecklistKind, weekdays, due_time, active: b.active !== false, items }
}

// ─── Günlük uygulama planı ───────────────────────────────────

export interface PlannableTemplate {
  id: string
  store_id: string
  name: string
  kind: ChecklistKind
  weekdays: number[]
  due_time: string | null
  active: boolean
}

/** Şablon bu tarihte uygulanır mı? (aktif + haftanın günü) */
export function appliesOnDate(t: Pick<PlannableTemplate, 'active' | 'weekdays'>, date: string): boolean {
  return t.active && t.weekdays.includes(dayOfWeekFromDateString(date))
}

/** Verilen tarih için henüz uygulaması olmayan, uygulanabilir şablonlar */
export function templatesMissingRun<T extends PlannableTemplate>(
  templates: T[],
  existingTemplateIds: ReadonlySet<string>,
  date: string
): T[] {
  return templates.filter((t) => appliesOnDate(t, date) && !existingTemplateIds.has(t.id))
}

// ─── Tamamlanma ──────────────────────────────────────────────

export interface CompletableItem {
  required: boolean
  done_at: string | null
}

/**
 * Uygulama tamamlandı mı? Tüm ZORUNLU maddeler işaretliyse. Hiç zorunlu madde yoksa tüm
 * maddelerin işaretli olması gerekir (boş liste hiçbir zaman tamamlanmış sayılmaz).
 */
export function isRunComplete(items: CompletableItem[]): boolean {
  if (items.length === 0) return false
  const required = items.filter((i) => i.required)
  const target = required.length > 0 ? required : items
  return target.every((i) => i.done_at != null)
}

// ─── Yetki ───────────────────────────────────────────────────

/** Madde işaretleyebilir mi: yönetici (aktif mağaza) ya da bugün bu mağazada vardiyası olan çalışan */
export function canTickChecklist({ isManager, hasShiftTodayInStore }: { isManager: boolean; hasShiftTodayInStore: boolean }): boolean {
  return isManager || hasShiftTodayInStore
}

/** Geri alma: yalnızca aynı gün; işareti koyan kişi ya da yönetici */
export function canUntickItem(args: {
  isManager: boolean
  actorId: string
  doneBy: string | null
  runDate: string
  today: string
}): boolean {
  if (args.runDate !== args.today) return false
  return args.isManager || (args.doneBy != null && args.doneBy === args.actorId)
}

// ─── Gecikme ─────────────────────────────────────────────────

/** 'YYYY-MM-DD' + 'HH:MM[:SS]' (Europe/Istanbul, sabit UTC+3) → ms epoch */
export function dueInstantMs(runDate: string, dueTime: string): number {
  return Date.parse(`${runDate}T${dueTime.slice(0, 5)}:00+03:00`)
}

/** Son saat + tolerans geçti ve tamamlanmadı mı? (SQL: scan_checklist_overdue ile aynı koşul) */
export function isRunOverdue(
  run: { run_date: string; due_time: string | null; completed_at: string | null },
  nowMs: number,
  graceMins = OVERDUE_GRACE_MINS
): boolean {
  if (run.completed_at || !run.due_time) return false
  return nowMs > dueInstantMs(run.run_date, run.due_time) + graceMins * 60_000
}

/** Geçmiş görünümü başlangıç tarihi (bugün dahil son n gün) */
export function historyFrom(today: string, days = 30): string {
  return addDaysToDateString(today, -(days - 1))
}
