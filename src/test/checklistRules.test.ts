// @vitest-environment node
/**
 * checklistRules.test.ts — kontrol listesi saf iş kuralları: gün uygulanabilirliği, tamamlanma,
 * işaretleme / geri alma yetkisi, gecikme, şablon doğrulama, iyimser güncelleme.
 */
import { describe, it, expect } from 'vitest'
import {
  ChecklistValidationError, appliesOnDate, canTickChecklist, canUntickItem, dueInstantMs, historyFrom,
  isRunComplete, isRunOverdue, parseTemplateInput, templatesMissingRun, type PlannableTemplate,
} from '@/lib/checklistRules'
import { applyItemToggle, moveItem } from '@/components/checklists/format'
import type { TodayChecklistsResponse } from '@/types/checklist'

const tpl = (over: Partial<PlannableTemplate> = {}): PlannableTemplate => ({
  id: 't1', store_id: 's1', name: 'Açılış', kind: 'opening', weekdays: [0, 1, 2, 3, 4, 5, 6], due_time: '10:00', active: true, ...over,
})

describe('gün uygulanabilirliği', () => {
  it('hafta içi günleri (0=Pazar) ve aktifliği dikkate alır', () => {
    // 2026-10-26 Pazartesi, 2026-10-25 Pazar
    expect(appliesOnDate(tpl({ weekdays: [1] }), '2026-10-26')).toBe(true)
    expect(appliesOnDate(tpl({ weekdays: [1] }), '2026-10-27')).toBe(false)
    expect(appliesOnDate(tpl({ weekdays: [0] }), '2026-10-25')).toBe(true)
    expect(appliesOnDate(tpl({ active: false }), '2026-10-26')).toBe(false)
  })

  it('yalnızca henüz uygulaması olmayan uygulanabilir şablonları döner', () => {
    const list = [tpl({ id: 'a' }), tpl({ id: 'b', weekdays: [2] }), tpl({ id: 'c' }), tpl({ id: 'd', active: false })]
    const out = templatesMissingRun(list, new Set(['c']), '2026-10-26')
    expect(out.map((t) => t.id)).toEqual(['a'])
  })
})

describe('tamamlanma kuralı', () => {
  const it_ = (required: boolean, done: boolean) => ({ required, done_at: done ? '2026-10-26T07:00:00Z' : null })
  it('tüm zorunlu maddeler işaretliyse tamamdır (isteğe bağlılar beklenmez)', () => {
    expect(isRunComplete([it_(true, true), it_(false, false)])).toBe(true)
    expect(isRunComplete([it_(true, true), it_(true, false)])).toBe(false)
  })
  it('zorunlu madde yoksa tüm maddeler gerekir; boş liste tamamlanmaz', () => {
    expect(isRunComplete([it_(false, true), it_(false, false)])).toBe(false)
    expect(isRunComplete([it_(false, true), it_(false, true)])).toBe(true)
    expect(isRunComplete([])).toBe(false)
  })
})

describe('yetki', () => {
  it('işaretleme: yönetici ya da bugün bu mağazada vardiyası olan', () => {
    expect(canTickChecklist({ isManager: true, hasShiftTodayInStore: false })).toBe(true)
    expect(canTickChecklist({ isManager: false, hasShiftTodayInStore: true })).toBe(true)
    expect(canTickChecklist({ isManager: false, hasShiftTodayInStore: false })).toBe(false)
  })
  it('geri alma: aynı gün + işaretleyen ya da yönetici', () => {
    const base = { actorId: 'me', doneBy: 'me', runDate: '2026-10-26', today: '2026-10-26' }
    expect(canUntickItem({ ...base, isManager: false })).toBe(true)
    expect(canUntickItem({ ...base, isManager: false, doneBy: 'other' })).toBe(false)
    expect(canUntickItem({ ...base, isManager: true, doneBy: 'other' })).toBe(true)
    expect(canUntickItem({ ...base, isManager: true, today: '2026-10-27' })).toBe(false)
  })
})

describe('gecikme', () => {
  const run = { run_date: '2026-10-26', due_time: '10:00', completed_at: null as string | null }
  const at = (hhmm: string) => Date.parse(`2026-10-26T${hhmm}:00+03:00`)
  it('son saat + 15 dk geçince gecikmiştir (Europe/Istanbul)', () => {
    expect(dueInstantMs('2026-10-26', '10:00')).toBe(at('10:00'))
    expect(isRunOverdue(run, at('10:15'))).toBe(false)
    expect(isRunOverdue(run, at('10:16'))).toBe(true)
  })
  it('tamamlanmış ya da son saati olmayan liste gecikmez', () => {
    expect(isRunOverdue({ ...run, completed_at: '2026-10-26T06:50:00Z' }, at('23:00'))).toBe(false)
    expect(isRunOverdue({ ...run, due_time: null }, at('23:00'))).toBe(false)
  })
})

describe('şablon doğrulama', () => {
  const ok = { name: ' Açılış ', kind: 'opening', items: [{ text: ' Kasa aç ', required: true }] }
  it('normalize eder: ad kırpılır, varsayılan her gün, son saat HH:MM', () => {
    const out = parseTemplateInput({ ...ok, due_time: '10:00:00' })
    expect(out).toMatchObject({ name: 'Açılış', weekdays: [0, 1, 2, 3, 4, 5, 6], due_time: '10:00', active: true })
    expect(out.items).toEqual([{ text: 'Kasa aç', required: true }])
  })
  it.each([
    ['boş ad', { ...ok, name: '  ' }],
    ['geçersiz tür', { ...ok, kind: 'x' }],
    ['madde yok', { ...ok, items: [] }],
    ['boş madde', { ...ok, items: [{ text: ' ' }] }],
    ['200+ karakter', { ...ok, items: [{ text: 'a'.repeat(201) }] }],
    ['geçersiz gün', { ...ok, weekdays: [7] }],
    ['boş gün listesi', { ...ok, weekdays: [] }],
    ['geçersiz saat', { ...ok, due_time: '25:00' }],
  ])('reddeder: %s', (_n, body) => {
    expect(() => parseTemplateInput(body)).toThrow(ChecklistValidationError)
  })
  it('geçmiş penceresi bugün dahil 30 gündür', () => {
    expect(historyFrom('2026-10-30', 30)).toBe('2026-10-01')
  })
})

describe('iyimser güncelleme ve sıralama', () => {
  const data: TodayChecklistsResponse = {
    date: '2026-10-26', can_tick: true, is_manager: false, current_employee_id: 'me',
    runs: [{
      id: 'r1', template_id: 't', run_date: '2026-10-26', name: 'Açılış', kind: 'opening', due_time: null,
      completed_at: null, completed_by_name: null, note: null, overdue: false,
      items: [
        { id: 'i1', position: 0, text: 'a', required: true, done_at: null, done_by: null, done_by_name: null },
        { id: 'i2', position: 1, text: 'b', required: false, done_at: null, done_by: null, done_by_name: null },
      ],
    }],
  }
  const actor = { id: 'me', name: 'Ayşe' }
  it('zorunlu madde işaretlenince liste tamamlanır, geri alınınca açılır', () => {
    const done = applyItemToggle(data, 'r1', 'i1', true, actor, '2026-10-26T07:00:00.000Z')
    expect(done.runs[0].completed_at).toBe('2026-10-26T07:00:00.000Z')
    expect(done.runs[0].items[0]).toMatchObject({ done_by: 'me', done_by_name: 'Ayşe' })
    const undone = applyItemToggle(done, 'r1', 'i1', false, actor, '2026-10-26T07:01:00.000Z')
    expect(undone.runs[0].completed_at).toBeNull()
    expect(data.runs[0].items[0].done_at).toBeNull() // girdi değişmez
  })
  it('moveItem sınır dışında aynı diziyi döner', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 3, 2])
    const l = [1, 2]
    expect(moveItem(l, 0, -1)).toBe(l)
  })
})
