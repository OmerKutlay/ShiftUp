/**
 * checklistRepository — kontrol listesi şablonları ve günlük uygulamaları (yalnızca server).
 *
 * Her sorgu aktif mağazaya (storeId) kapsanır; istemciden gelen şablon / uygulama / madde id'leri
 * mağazaya ait olduğu doğrulanmadan işlenmez (service role RLS'yi bypass eder).
 * Uygulamalar tembel oluşur (ensureTodayRuns) — SQL tarafındaki ensure_checklist_runs() ile
 * aynı mantık; ikisi de UNIQUE(template_id, run_date) / UNIQUE(run_id, position) ile idempotent.
 */
import { db } from '@/lib/db'
import {
  ChecklistValidationError,
  canTickChecklist,
  canUntickItem,
  isRunComplete,
  isRunOverdue,
  parseTemplateInput,
  templatesMissingRun,
  MAX_NOTE,
  type PlannableTemplate,
} from '@/lib/checklistRules'
import type {
  ChecklistHistoryRun,
  ChecklistKind,
  ChecklistRun,
  ChecklistRunItem,
  ChecklistTemplate,
  ChecklistTemplateInput,
} from '@/types/checklist'

/** Kayıt yok ya da başka mağazaya ait (varlığı sızdırılmaz) */
export class ChecklistNotFoundError extends Error {
  constructor(message = 'Kayıt bulunamadı.') {
    super(message)
    this.name = 'ChecklistNotFoundError'
  }
}

export class ChecklistForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChecklistForbiddenError'
  }
}

type Row = Record<string, unknown>

const hhmm = (t: unknown): string | null => (typeof t === 'string' ? t.slice(0, 5) : null)

// ============================================================
// Şablonlar
// ============================================================

function toTemplate(row: Row, items: Row[]): ChecklistTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as ChecklistKind,
    weekdays: ((row.weekdays as number[] | null) ?? []).map(Number),
    due_time: hhmm(row.due_time),
    active: row.active as boolean,
    items: items
      .filter((i) => i.template_id === row.id)
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((i) => ({ id: i.id as string, position: i.position as number, text: i.text as string, required: i.required as boolean })),
  }
}

async function fetchTemplateItems(templateIds: string[]): Promise<Row[]> {
  if (templateIds.length === 0) return []
  const { data, error } = await db
    .from('checklist_template_items')
    .select('id, template_id, position, text, required')
    .in('template_id', templateIds)
  if (error) throw new Error(`Liste maddeleri yüklenemedi: ${error.message}`)
  return (data ?? []) as Row[]
}

/** Mağazanın tüm şablonları (pasifler dahil), maddeleriyle */
export async function fetchTemplates(storeId: string): Promise<ChecklistTemplate[]> {
  const { data, error } = await db
    .from('checklist_templates')
    .select('id, name, kind, weekdays, due_time, active')
    .eq('store_id', storeId)
    .order('name', { ascending: true })
  if (error) throw new Error(`Kontrol listeleri yüklenemedi: ${error.message}`)
  const rows = (data ?? []) as Row[]
  const items = await fetchTemplateItems(rows.map((r) => r.id as string))
  return rows.map((r) => toTemplate(r, items))
}

/** Şablon bu mağazaya ait değilse / yoksa null */
export async function fetchTemplate(id: string, storeId: string): Promise<ChecklistTemplate | null> {
  const { data, error } = await db
    .from('checklist_templates')
    .select('id, name, kind, weekdays, due_time, active')
    .eq('id', id)
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw new Error(`Kontrol listesi yüklenemedi: ${error.message}`)
  if (!data) return null
  const items = await fetchTemplateItems([id])
  return toTemplate(data as Row, items)
}

async function writeItems(templateId: string, items: ChecklistTemplateInput['items']): Promise<void> {
  const del = await db.from('checklist_template_items').delete().eq('template_id', templateId)
  if (del.error) throw new Error(`Maddeler güncellenemedi: ${del.error.message}`)
  const ins = await db
    .from('checklist_template_items')
    .insert(items.map((it, position) => ({ template_id: templateId, position, text: it.text, required: it.required })))
  if (ins.error) throw new Error(`Maddeler eklenemedi: ${ins.error.message}`)
}

export async function createTemplate(
  input: ChecklistTemplateInput,
  storeId: string,
  actorId: string
): Promise<ChecklistTemplate> {
  const { data, error } = await db
    .from('checklist_templates')
    .insert({
      store_id: storeId,
      name: input.name,
      kind: input.kind,
      weekdays: input.weekdays,
      due_time: input.due_time,
      active: input.active,
      created_by: actorId,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Kontrol listesi oluşturulamadı: ${error?.message}`)
  const id = (data as Row).id as string
  await writeItems(id, input.items)
  const created = await fetchTemplate(id, storeId)
  if (!created) throw new Error('Kontrol listesi oluşturuldu ancak okunamadı.')
  return created
}

/** Mevcut şablonla birleştirilmiş tam girdiyle günceller (kısmi PATCH desteği). */
export async function updateTemplate(
  id: string,
  patch: Record<string, unknown>,
  storeId: string
): Promise<{ before: ChecklistTemplate; after: ChecklistTemplate }> {
  const before = await fetchTemplate(id, storeId)
  if (!before) throw new ChecklistNotFoundError('Kontrol listesi bulunamadı.')

  const input = parseTemplateInput({
    name: before.name,
    kind: before.kind,
    weekdays: before.weekdays,
    due_time: before.due_time,
    active: before.active,
    items: before.items.map((i) => ({ text: i.text, required: i.required })),
    ...patch,
  })

  const { error } = await db
    .from('checklist_templates')
    .update({
      name: input.name,
      kind: input.kind,
      weekdays: input.weekdays,
      due_time: input.due_time,
      active: input.active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('store_id', storeId)
  if (error) throw new Error(`Kontrol listesi güncellenemedi: ${error.message}`)
  if (patch.items !== undefined) await writeItems(id, input.items)

  const after = await fetchTemplate(id, storeId)
  if (!after) throw new ChecklistNotFoundError('Kontrol listesi bulunamadı.')
  return { before, after }
}

// ============================================================
// Günlük uygulamalar
// ============================================================

/**
 * Bugünün uygulamalarını oluşturur (yoksa). Idempotent: UNIQUE(template_id, run_date) üzerinde
 * ignoreDuplicates upsert; madde kopyaları hiç maddesi olmayan uygulamalara eklenir
 * (UNIQUE(run_id, position) → yarışta kaybeden de aynı sonucu üretir).
 */
export async function ensureTodayRuns(storeId: string, today: string): Promise<void> {
  const tpl = await db
    .from('checklist_templates')
    .select('id, store_id, name, kind, weekdays, due_time, active')
    .eq('store_id', storeId)
    .eq('active', true)
  if (tpl.error) throw new Error(`Kontrol listeleri yüklenemedi: ${tpl.error.message}`)
  const templates = ((tpl.data ?? []) as Row[]).map((r): PlannableTemplate => ({
    id: r.id as string,
    store_id: r.store_id as string,
    name: r.name as string,
    kind: r.kind as ChecklistKind,
    weekdays: ((r.weekdays as number[] | null) ?? []).map(Number),
    due_time: hhmm(r.due_time),
    active: r.active as boolean,
  }))
  if (templates.length === 0) return

  const existing = await db.from('checklist_runs').select('id, template_id').eq('store_id', storeId).eq('run_date', today)
  if (existing.error) throw new Error(`Kontrol listesi uygulamaları yüklenemedi: ${existing.error.message}`)
  const existingRuns = (existing.data ?? []) as Row[]

  const missing = templatesMissingRun(templates, new Set(existingRuns.map((r) => r.template_id as string)), today)
  if (missing.length > 0) {
    const up = await db.from('checklist_runs').upsert(
      missing.map((t) => ({
        store_id: storeId, template_id: t.id, run_date: today, name: t.name, kind: t.kind, due_time: t.due_time,
      })),
      { onConflict: 'template_id,run_date', ignoreDuplicates: true }
    )
    if (up.error) throw new Error(`Kontrol listesi uygulaması oluşturulamadı: ${up.error.message}`)
  }

  // Madde kopyası: uygulamaları yeniden oku, maddesi olmayanları doldur
  const runsRes = await db.from('checklist_runs').select('id, template_id').eq('store_id', storeId).eq('run_date', today)
  if (runsRes.error) throw new Error(`Kontrol listesi uygulamaları yüklenemedi: ${runsRes.error.message}`)
  const runs = (runsRes.data ?? []) as Row[]
  if (runs.length === 0) return
  const runIds = runs.map((r) => r.id as string)
  const itemsRes = await db.from('checklist_run_items').select('run_id').in('run_id', runIds)
  if (itemsRes.error) throw new Error(`Liste maddeleri yüklenemedi: ${itemsRes.error.message}`)
  const filled = new Set(((itemsRes.data ?? []) as Row[]).map((r) => r.run_id as string))
  const empty = runs.filter((r) => !filled.has(r.id as string))
  if (empty.length === 0) return

  const tItems = await fetchTemplateItems(empty.map((r) => r.template_id as string))
  const rows = empty.flatMap((r) =>
    tItems
      .filter((i) => i.template_id === r.template_id)
      .map((i) => ({ run_id: r.id, position: i.position, text: i.text, required: i.required }))
  )
  if (rows.length === 0) return
  const ins = await db.from('checklist_run_items').upsert(rows, { onConflict: 'run_id,position', ignoreDuplicates: true })
  if (ins.error) throw new Error(`Liste maddeleri kopyalanamadı: ${ins.error.message}`)
}

async function employeeNames(ids: (string | null)[], storeId: string): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  if (unique.length === 0) return new Map()
  const { data, error } = await db.from('employees').select('id, full_name').in('id', unique).eq('store_id', storeId)
  if (error) throw new Error(`Çalışanlar yüklenemedi: ${error.message}`)
  return new Map(((data ?? []) as Row[]).map((e) => [e.id as string, e.full_name as string]))
}

/** Bugünün uygulamaları (maddeleriyle). Önce eksik uygulamaları oluşturur. */
export async function fetchTodayRuns(storeId: string, today: string, nowMs = Date.now()): Promise<ChecklistRun[]> {
  await ensureTodayRuns(storeId, today)

  const runsRes = await db
    .from('checklist_runs')
    .select('id, template_id, run_date, name, kind, due_time, completed_at, completed_by, note')
    .eq('store_id', storeId)
    .eq('run_date', today)
  if (runsRes.error) throw new Error(`Kontrol listesi uygulamaları yüklenemedi: ${runsRes.error.message}`)
  const runs = (runsRes.data ?? []) as Row[]
  if (runs.length === 0) return []

  const itemsRes = await db
    .from('checklist_run_items')
    .select('id, run_id, position, text, required, done_at, done_by')
    .in('run_id', runs.map((r) => r.id as string))
  if (itemsRes.error) throw new Error(`Liste maddeleri yüklenemedi: ${itemsRes.error.message}`)
  const items = (itemsRes.data ?? []) as Row[]

  const names = await employeeNames([...items.map((i) => i.done_by as string | null), ...runs.map((r) => r.completed_by as string | null)], storeId)

  return runs
    .map((r): ChecklistRun => {
      const run = {
        id: r.id as string,
        template_id: r.template_id as string,
        run_date: r.run_date as string,
        name: r.name as string,
        kind: r.kind as ChecklistKind,
        due_time: hhmm(r.due_time),
        completed_at: (r.completed_at as string | null) ?? null,
        completed_by_name: r.completed_by ? names.get(r.completed_by as string) ?? null : null,
        note: (r.note as string | null) ?? null,
      }
      const runItems: ChecklistRunItem[] = items
        .filter((i) => i.run_id === r.id)
        .sort((a, b) => (a.position as number) - (b.position as number))
        .map((i) => ({
          id: i.id as string,
          position: i.position as number,
          text: i.text as string,
          required: i.required as boolean,
          done_at: (i.done_at as string | null) ?? null,
          done_by: (i.done_by as string | null) ?? null,
          done_by_name: i.done_by ? names.get(i.done_by as string) ?? null : null,
        }))
      return { ...run, items: runItems, overdue: isRunOverdue(run, nowMs) }
    })
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name, 'tr'))
}

const kindRank = (k: ChecklistKind) => (k === 'opening' ? 0 : k === 'custom' ? 1 : 2)

/** Çalışanın bugün bu mağazada (izinli olmayan) vardiyası var mı? */
export async function hasShiftTodayInStore(employeeId: string, storeId: string, today: string): Promise<boolean> {
  const { data, error } = await db
    .from('shift_assignments')
    .select('id, is_on_leave')
    .eq('employee_id', employeeId)
    .eq('store_id', storeId)
    .eq('work_date', today)
  if (error) throw new Error(`Vardiya sorgulanamadı: ${error.message}`)
  return ((data ?? []) as Row[]).some((s) => s.is_on_leave !== true)
}

/** Uygulama bu mağazaya ait mi? Değilse ChecklistNotFoundError */
async function getRunInStore(runId: string, storeId: string): Promise<Row> {
  const { data, error } = await db
    .from('checklist_runs')
    .select('id, store_id, run_date, completed_at, completed_by')
    .eq('id', runId)
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) throw new Error(`Kontrol listesi yüklenemedi: ${error.message}`)
  if (!data) throw new ChecklistNotFoundError('Kontrol listesi bulunamadı.')
  return data as Row
}

interface Actor {
  id: string
  isManager: boolean
}

/** Bugün için işaretleme yetkisini doğrular (yönetici ya da bugün bu mağazada vardiyası olan) */
async function assertCanTick(actor: Actor, storeId: string, today: string): Promise<void> {
  const hasShift = actor.isManager ? false : await hasShiftTodayInStore(actor.id, storeId, today)
  if (!canTickChecklist({ isManager: actor.isManager, hasShiftTodayInStore: hasShift })) {
    throw new ChecklistForbiddenError('Kontrol listesini yalnızca bugün bu mağazada vardiyası olanlar işaretleyebilir.')
  }
}

/**
 * Maddeyi işaretler / geri alır. Yalnızca bugünün uygulaması düzenlenir.
 * İşaretleme: yönetici ya da bugün bu mağazada vardiyası olan çalışan.
 * Geri alma: işareti koyan kişi ya da yönetici (aynı gün).
 * Sonrasında uygulamanın tamamlanma durumu yeniden hesaplanır.
 */
export async function setItemDone(args: {
  runId: string
  itemId: string
  done: boolean
  actor: Actor
  storeId: string
  today: string
  nowIso?: string
}): Promise<{ item: { id: string; done_at: string | null; done_by: string | null }; completed_at: string | null; completed_by: string | null }> {
  const { runId, itemId, done, actor, storeId, today } = args
  const run = await getRunInStore(runId, storeId)
  if (run.run_date !== today) {
    throw new ChecklistForbiddenError('Yalnızca bugünün kontrol listeleri düzenlenebilir.')
  }

  const itemRes = await db
    .from('checklist_run_items')
    .select('id, run_id, required, done_at, done_by')
    .eq('id', itemId)
    .eq('run_id', runId)
    .maybeSingle()
  if (itemRes.error) throw new Error(`Madde yüklenemedi: ${itemRes.error.message}`)
  if (!itemRes.data) throw new ChecklistNotFoundError('Madde bulunamadı.')
  const item = itemRes.data as Row

  const nowIso = args.nowIso ?? new Date().toISOString()
  if (done) {
    await assertCanTick(actor, storeId, today)
    if (!item.done_at) {
      const upd = await db.from('checklist_run_items').update({ done_at: nowIso, done_by: actor.id }).eq('id', itemId)
      if (upd.error) throw new Error(`Madde işaretlenemedi: ${upd.error.message}`)
    }
  } else if (item.done_at) {
    const allowed = canUntickItem({
      isManager: actor.isManager, actorId: actor.id, doneBy: (item.done_by as string | null) ?? null,
      runDate: run.run_date as string, today,
    })
    if (!allowed) throw new ChecklistForbiddenError('Bu işareti yalnızca işaretleyen kişi ya da bir yönetici geri alabilir.')
    const upd = await db.from('checklist_run_items').update({ done_at: null, done_by: null }).eq('id', itemId)
    if (upd.error) throw new Error(`İşaret geri alınamadı: ${upd.error.message}`)
  }

  // Tamamlanma durumunu yeniden hesapla
  const all = await db.from('checklist_run_items').select('id, required, done_at').eq('run_id', runId)
  if (all.error) throw new Error(`Liste maddeleri yüklenemedi: ${all.error.message}`)
  const complete = isRunComplete(((all.data ?? []) as Row[]).map((i) => ({ required: i.required as boolean, done_at: (i.done_at as string | null) ?? null })))

  let completed_at = (run.completed_at as string | null) ?? null
  let completed_by = (run.completed_by as string | null) ?? null
  if (complete && !completed_at) {
    completed_at = nowIso
    completed_by = actor.id
  } else if (!complete && completed_at) {
    completed_at = null
    completed_by = null
  }
  if (completed_at !== ((run.completed_at as string | null) ?? null)) {
    const upd = await db.from('checklist_runs').update({ completed_at, completed_by }).eq('id', runId).eq('store_id', storeId)
    if (upd.error) throw new Error(`Liste durumu güncellenemedi: ${upd.error.message}`)
  }

  const fresh = await db.from('checklist_run_items').select('id, done_at, done_by').eq('id', itemId).single()
  const f = (fresh.data ?? { id: itemId, done_at: null, done_by: null }) as Row
  return {
    item: { id: itemId, done_at: (f.done_at as string | null) ?? null, done_by: (f.done_by as string | null) ?? null },
    completed_at,
    completed_by,
  }
}

/** Bugünün uygulamasına serbest not yazar (aynı işaretleme yetkisi) */
export async function setRunNote(args: {
  runId: string
  note: string | null
  actor: Actor
  storeId: string
  today: string
}): Promise<string | null> {
  const { runId, actor, storeId, today } = args
  const note = args.note?.trim() ? args.note.trim() : null
  if (note && note.length > MAX_NOTE) throw new ChecklistValidationError(`Not en fazla ${MAX_NOTE} karakter olabilir.`)
  const run = await getRunInStore(runId, storeId)
  if (run.run_date !== today) throw new ChecklistForbiddenError('Yalnızca bugünün kontrol listeleri düzenlenebilir.')
  await assertCanTick(actor, storeId, today)
  const upd = await db.from('checklist_runs').update({ note }).eq('id', runId).eq('store_id', storeId)
  if (upd.error) throw new Error(`Not kaydedilemedi: ${upd.error.message}`)
  return note
}

// ============================================================
// Geçmiş
// ============================================================

export async function fetchHistory(storeId: string, from: string, to: string): Promise<ChecklistHistoryRun[]> {
  const runsRes = await db
    .from('checklist_runs')
    .select('id, template_id, run_date, name, kind, due_time, completed_at, completed_by')
    .eq('store_id', storeId)
    .gte('run_date', from)
    .lte('run_date', to)
    .order('run_date', { ascending: false })
  if (runsRes.error) throw new Error(`Geçmiş yüklenemedi: ${runsRes.error.message}`)
  const runs = (runsRes.data ?? []) as Row[]
  if (runs.length === 0) return []

  // Maddeler sayfalanarak okunur (PostgREST max_rows)
  const runIds = runs.map((r) => r.id as string)
  const counts = new Map<string, { done: number; total: number }>()
  const PAGE = 1000
  for (let start = 0; ; start += PAGE) {
    const res = await db
      .from('checklist_run_items')
      .select('run_id, done_at')
      .in('run_id', runIds)
      .order('run_id')
      .order('position')
      .range(start, start + PAGE - 1)
    if (res.error) throw new Error(`Geçmiş maddeleri yüklenemedi: ${res.error.message}`)
    const page = (res.data ?? []) as Row[]
    for (const i of page) {
      const c = counts.get(i.run_id as string) ?? { done: 0, total: 0 }
      c.total += 1
      if (i.done_at) c.done += 1
      counts.set(i.run_id as string, c)
    }
    if (page.length < PAGE) break
  }

  const names = await employeeNames(runs.map((r) => r.completed_by as string | null), storeId)
  return runs.map((r) => ({
    id: r.id as string,
    template_id: r.template_id as string,
    run_date: r.run_date as string,
    name: r.name as string,
    kind: r.kind as ChecklistKind,
    due_time: hhmm(r.due_time),
    completed_at: (r.completed_at as string | null) ?? null,
    completed_by_name: r.completed_by ? names.get(r.completed_by as string) ?? null : null,
    done: counts.get(r.id as string)?.done ?? 0,
    total: counts.get(r.id as string)?.total ?? 0,
  }))
}
