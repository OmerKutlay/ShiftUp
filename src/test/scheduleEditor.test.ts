import { describe, it, expect } from 'vitest'
import type { ShiftTemplate } from '@/types/shiftTemplate'
import type { ShiftAssignmentWithDetails } from '@/types/schedule'
import {
  ERASE_STONE, applyDrafts, customStone, paintCell, saveSteps, templateStones,
  type CellOriginal, type DraftMap,
} from '@/components/schedule/scheduleEditor'

const EMP = '11111111-1111-1111-1111-111111111111'
const DAY = '2026-09-28'
const KEY = `${EMP}:${DAY}`

const tpl = (over: Partial<ShiftTemplate> = {}): ShiftTemplate => ({
  id: 'tpl-open', name: 'Açılış', start_time: '09:00:00', end_time: '18:00:00', description: null, active: true,
  created_at: '', updated_at: '', ...over,
})
const OPEN = tpl()
const CLOSE = tpl({ id: 'tpl-close', name: 'Kapanış', start_time: '14:00:00', end_time: '23:00:00' })
const [OPEN_STONE, CLOSE_STONE] = templateStones([OPEN, CLOSE])

const asgn = (over: Partial<ShiftAssignmentWithDetails> = {}): ShiftAssignmentWithDetails => ({
  id: 'asgn-1', employee_id: EMP, shift_template_id: OPEN.id, work_date: DAY, start_time: '09:00:00', end_time: '18:00:00',
  is_on_leave: false, created_at: '', updated_at: '', shift_templates: OPEN, employees: null, ...over,
})
const empty: CellOriginal = { assignment: null, restLeaveId: null, locked: null }
const none: DraftMap = new Map()

describe('templateStones', () => {
  it('şablon saatlerini HH:MM taşlara çevirir', () => {
    expect(OPEN_STONE).toEqual({ id: 'tpl:tpl-open', type: 'shift', label: 'Açılış', templateId: 'tpl-open', start: '09:00', end: '18:00' })
  })
})

describe('paintCell', () => {
  it('boş hücreye taş taslak ekler, aynı taşla tekrar boyamak etkisizdir', () => {
    const once = paintCell(none, KEY, OPEN_STONE, empty)
    expect(once.get(KEY)).toEqual({ type: 'shift', templateId: 'tpl-open', start: '09:00', end: '18:00' })
    expect(paintCell(once, KEY, OPEN_STONE, empty)).toBe(once)
  })

  it('kayıtlı haline dönen hücrenin taslağı silinir', () => {
    const orig: CellOriginal = { ...empty, assignment: asgn() }
    const changed = paintCell(none, KEY, CLOSE_STONE, orig)
    expect(changed.size).toBe(1)
    expect(paintCell(changed, KEY, OPEN_STONE, orig).size).toBe(0)
    // Zaten aynı vardiya: hiç taslak oluşmaz
    expect(paintCell(none, KEY, OPEN_STONE, orig)).toBe(none)
  })

  it('kilitli hücre boyanmaz', () => {
    expect(paintCell(none, KEY, OPEN_STONE, { ...empty, locked: 'İzinli' })).toBe(none)
  })

  it('silgi boş hücrede etkisiz, tatil günündeyse taslak olur', () => {
    expect(paintCell(none, KEY, ERASE_STONE, empty)).toBe(none)
    expect(paintCell(none, KEY, ERASE_STONE, { ...empty, restLeaveId: 'lv-1' }).get(KEY)).toEqual({ type: 'clear' })
  })
})

describe('applyDrafts', () => {
  const view = { assignments: [asgn()], restDayMap: new Set<string>(), approvedLeaveMap: new Set<string>() }

  it('vardiya taslağı mevcut vardiyanın saatini ve şablonunu değiştirir', () => {
    const out = applyDrafts(view, paintCell(none, KEY, CLOSE_STONE, { ...empty, assignment: asgn() }), [OPEN, CLOSE])
    expect(out.assignments).toHaveLength(1)
    expect(out.assignments[0]).toMatchObject({ id: 'asgn-1', start_time: '14:00', end_time: '23:00', shift_template_id: 'tpl-close' })
    expect(out.assignments[0].shift_templates?.name).toBe('Kapanış')
  })

  it('tatil taslağı vardiyayı kaldırır ve günü tatil yapar', () => {
    const out = applyDrafts(view, new Map([[KEY, { type: 'rest' }]]), [OPEN])
    expect(out.assignments).toHaveLength(0)
    expect(out.restDayMap.has(KEY)).toBe(true)
    expect(out.approvedLeaveMap.has(KEY)).toBe(true)
  })

  it('yeni hücreye özel saatli taslak vardiya ekler', () => {
    const other = `${EMP}:2026-09-29`
    const out = applyDrafts(view, paintCell(none, other, customStone('Ara', '11:00', '20:00'), empty), [OPEN])
    expect(out.assignments.map((a) => a.id)).toEqual(['asgn-1', `draft:${other}`])
    expect(out.assignments[1]).toMatchObject({ work_date: '2026-09-29', shift_template_id: null, start_time: '11:00' })
  })

  it('taslak yoksa aynı veriyi döner', () => {
    expect(applyDrafts(view, none, [])).toBe(view)
  })
})

describe('saveSteps', () => {
  it('boş hücre → oluştur, dolu hücre → güncelle', () => {
    expect(saveSteps(KEY, { type: 'shift', templateId: 'tpl-close', start: '14:00', end: '23:00' }, empty)).toEqual([
      { op: 'createShift', payload: { employee_id: EMP, work_date: DAY, shift_template_id: 'tpl-close', start_time: '14:00', end_time: '23:00' } },
    ])
    expect(saveSteps(KEY, { type: 'shift', templateId: 'tpl-close', start: '14:00', end: '23:00' }, { ...empty, assignment: asgn() })).toEqual([
      { op: 'updateShift', id: 'asgn-1', employeeId: EMP, date: DAY, payload: { shift_template_id: 'tpl-close', start_time: '14:00', end_time: '23:00' } },
    ])
  })

  it('tatil gününe vardiya: önce tatil silinir', () => {
    const steps = saveSteps(KEY, { type: 'shift', templateId: OPEN.id, start: '09:00', end: '18:00' }, { ...empty, restLeaveId: 'lv-1' })
    expect(steps.map((s) => s.op)).toEqual(['deleteLeave', 'createShift'])
  })

  it('tatil ve silgi', () => {
    expect(saveSteps(KEY, { type: 'rest' }, { ...empty, assignment: asgn() })).toEqual([{ op: 'createRest', employeeId: EMP, date: DAY }])
    expect(saveSteps(KEY, { type: 'clear' }, { ...empty, assignment: asgn() })).toEqual([{ op: 'deleteShift', id: 'asgn-1' }])
    expect(saveSteps(KEY, { type: 'clear' }, { ...empty, restLeaveId: 'lv-1' })).toEqual([{ op: 'deleteLeave', leaveId: 'lv-1' }])
  })

  it('kilitli ya da değişmemiş hücre için adım yok', () => {
    expect(saveSteps(KEY, { type: 'rest' }, { ...empty, locked: 'İzinli' })).toEqual([])
    expect(saveSteps(KEY, { type: 'clear' }, empty)).toEqual([])
  })
})
