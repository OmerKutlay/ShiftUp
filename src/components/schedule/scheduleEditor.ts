/**
 * scheduleEditor — haftalık plan editör modunun saf mantığı.
 *
 * Yönetici paletten bir "taş" seçer (vardiya şablonu, özel saat, tatil ya da silgi) ve tıkladığı
 * her hücre o taşla boyanır. Boyamalar sunucuya hemen gitmez: hücre anahtarı → taslak haritasında
 * birikir, tablo taslaklar uygulanmış haliyle çizilir, "Kaydet" ile hücre başına kayıt adımlarına
 * çevrilip sırayla gönderilir.
 */
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { CreateShiftAssignmentPayload, ShiftAssignmentWithDetails, UpdateShiftAssignmentPayload } from '@/types/schedule'

// ─── Taşlar ───────────────────────────────────────────────────

export type ShiftStone = {
  id: string
  type: 'shift'
  label: string
  /** null → şablonsuz özel saat */
  templateId: string | null
  start: string  // 'HH:MM'
  end: string    // 'HH:MM'
}
export type EditorStone = ShiftStone | { id: 'rest'; type: 'rest' } | { id: 'erase'; type: 'erase' }

export const REST_STONE: EditorStone = { id: 'rest', type: 'rest' }
export const ERASE_STONE: EditorStone = { id: 'erase', type: 'erase' }

/** Aktif vardiya şablonlarından taşlar (şablon sırasıyla) */
export function templateStones(templates: ShiftTemplate[]): ShiftStone[] {
  return templates.map((t) => ({
    id: `tpl:${t.id}`,
    type: 'shift',
    label: t.name,
    templateId: t.id,
    start: t.start_time.slice(0, 5),
    end: t.end_time.slice(0, 5),
  }))
}

/** Yöneticinin eklediği özel saatli taş */
export function customStone(label: string, start: string, end: string): ShiftStone {
  return { id: `custom:${start}-${end}:${label}`, type: 'shift', label, templateId: null, start, end }
}

// ─── Taslaklar ────────────────────────────────────────────────

export type CellDraft =
  | { type: 'shift'; templateId: string | null; start: string; end: string }
  | { type: 'rest' }
  | { type: 'clear' }

/** Anahtar: `${employeeId}:${YYYY-MM-DD}` */
export type DraftMap = ReadonlyMap<string, CellDraft>

/** Hücrenin sunucudaki (kayıtlı) durumu */
export interface CellOriginal {
  assignment: ShiftAssignmentWithDetails | null
  /** Bu günü kapsayan tek günlük haftalık tatil kaydı */
  restLeaveId: string | null
  /** Doluysa hücre editörde değiştirilemez; neden */
  locked: string | null
}

export const cellKey = (employeeId: string, date: string) => `${employeeId}:${date}`

export function splitKey(key: string): { employeeId: string; date: string } {
  const i = key.lastIndexOf(':')
  return { employeeId: key.slice(0, i), date: key.slice(i + 1) }
}

export function draftFromStone(stone: EditorStone): CellDraft {
  if (stone.type === 'shift') return { type: 'shift', templateId: stone.templateId, start: stone.start, end: stone.end }
  return { type: stone.type === 'rest' ? 'rest' : 'clear' }
}

/** Taslak hücrenin kayıtlı haliyle aynı mı (kaydedilecek bir şey yok) */
export function sameAsOriginal(draft: CellDraft, orig: CellOriginal): boolean {
  const a = orig.assignment
  switch (draft.type) {
    case 'shift':
      return !!a && !orig.restLeaveId
        && a.start_time.slice(0, 5) === draft.start
        && a.end_time.slice(0, 5) === draft.end
        && (a.shift_template_id ?? null) === draft.templateId
    case 'rest':
      return !!orig.restLeaveId && !a
    case 'clear':
      return !a && !orig.restLeaveId
  }
}

/**
 * Hücreyi taşla boyar. Değişiklik yoksa aynı haritayı döner (React gereksiz render yapmaz);
 * kayıtlı haline dönen hücrenin taslağı silinir. Aynı taşla tekrar boyamak etkisizdir.
 */
export function paintCell(drafts: DraftMap, key: string, stone: EditorStone, orig: CellOriginal): DraftMap {
  if (orig.locked) return drafts
  const draft = draftFromStone(stone)
  if (sameAsOriginal(draft, orig)) {
    if (!drafts.has(key)) return drafts
    const next = new Map(drafts)
    next.delete(key)
    return next
  }
  const prev = drafts.get(key)
  if (prev && JSON.stringify(prev) === JSON.stringify(draft)) return drafts
  return new Map(drafts).set(key, draft)
}

// ─── Taslakların tabloya uygulanması ──────────────────────────

export interface ScheduleView {
  assignments: ShiftAssignmentWithDetails[]
  restDayMap: Set<string>
  approvedLeaveMap: Set<string>
}

/**
 * Kayıtlı veriye taslakları uygular: tablo, haftalık özetler ve uyarılar kaydetmeden önce
 * değişikliklerin sonucunu gösterir. Taslak vardiyaların id'si `draft:` ile başlar.
 */
export function applyDrafts(view: ScheduleView, drafts: DraftMap, templates: ShiftTemplate[]): ScheduleView {
  if (drafts.size === 0) return view
  const restDayMap = new Set(view.restDayMap)
  const approvedLeaveMap = new Set(view.approvedLeaveMap)
  const byKey = new Map(view.assignments.map((a) => [cellKey(a.employee_id, a.work_date), a]))

  for (const [key, draft] of drafts) {
    const existing = byKey.get(key)
    if (draft.type === 'shift') {
      const { employeeId, date } = splitKey(key)
      const tpl = draft.templateId ? templates.find((t) => t.id === draft.templateId) ?? null : null
      const base: ShiftAssignmentWithDetails = existing ?? {
        id: `draft:${key}`, employee_id: employeeId, work_date: date, shift_template_id: null,
        start_time: draft.start, end_time: draft.end, is_on_leave: false,
        created_at: '', updated_at: '', shift_templates: null, employees: null,
      }
      byKey.set(key, {
        ...base,
        shift_template_id: draft.templateId,
        shift_templates: tpl,
        start_time: draft.start,
        end_time: draft.end,
        is_on_leave: false,
        worked_minutes: null,
      })
      restDayMap.delete(key)
      approvedLeaveMap.delete(key)
    } else {
      byKey.delete(key)
      if (draft.type === 'rest') {
        restDayMap.add(key)
        approvedLeaveMap.add(key)
      } else {
        restDayMap.delete(key)
        approvedLeaveMap.delete(key)
      }
    }
  }
  return { assignments: [...byKey.values()], restDayMap, approvedLeaveMap }
}

// ─── Kayıt adımları ───────────────────────────────────────────

export type SaveStep =
  | { op: 'deleteLeave'; leaveId: string }
  | { op: 'deleteShift'; id: string }
  | { op: 'createShift'; payload: CreateShiftAssignmentPayload }
  | { op: 'updateShift'; id: string; employeeId: string; date: string; payload: UpdateShiftAssignmentPayload }
  | { op: 'createRest'; employeeId: string; date: string }

/** Bir hücrenin taslağını kayıtlı durumdan hedefe götüren API adımları (sırası önemli) */
export function saveSteps(key: string, draft: CellDraft, orig: CellOriginal): SaveStep[] {
  if (orig.locked || sameAsOriginal(draft, orig)) return []
  const { employeeId, date } = splitKey(key)
  const a = orig.assignment
  const steps: SaveStep[] = []

  switch (draft.type) {
    case 'shift': {
      // Tatil günü vardiya atanamaz: önce tatil kaldırılır
      if (orig.restLeaveId) steps.push({ op: 'deleteLeave', leaveId: orig.restLeaveId })
      const times = { shift_template_id: draft.templateId, start_time: draft.start, end_time: draft.end }
      steps.push(a
        ? { op: 'updateShift', id: a.id, employeeId, date, payload: times }
        : { op: 'createShift', payload: { employee_id: employeeId, work_date: date, ...times } })
      break
    }
    case 'rest':
      // Sunucu, tatil atanan günün planlanmış vardiyasını kendisi kaldırır
      steps.push({ op: 'createRest', employeeId, date })
      break
    case 'clear':
      if (a) steps.push({ op: 'deleteShift', id: a.id })
      if (orig.restLeaveId) steps.push({ op: 'deleteLeave', leaveId: orig.restLeaveId })
      break
  }
  return steps
}
