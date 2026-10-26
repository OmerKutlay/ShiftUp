/**
 * checklistRepository — kontrol listesi şablonları ve günlük uygulamaları (yalnızca server).
 *
 * Her sorgu aktif mağazaya (storeId) kapsanır; istemciden gelen şablon / uygulama / madde id'leri
 * mağazaya ait olduğu doğrulanmadan işlenmez (service role RLS'yi bypass eder).
 * Uygulamalar tembel oluşur (ensureTodayRuns) — SQL tarafındaki ensure_checklist_runs() ile
 * aynı mantık; ikisi de UNIQUE(template_id, run_date) / UNIQUE(run_id, position) ile idempotent.
 * Çok adımlı yazmalar (şablon + maddeleri, tik + tamamlanma) tek işlemlik SQL fonksiyonlarıdır
 * (save_checklist_template / set_checklist_item).
 */
import { db } from '@/lib/db'
import {
  ChecklistValidationError,
  activeRunDates,
  canTickChecklist,
  isRunEditable,
  isRunOverdue,
  parseTemplateInput,
  shiftGrantsTick,
  templatesMissingRun,
  MAX_NOTE,
  OVERDUE_GRACE_MINS,
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

/** SQL fonksiyonlarının hata kodlarını (P0002 yok, 42501 yetki, 22023 geçersiz) API hatalarına çevirir */
function throwRpcError(error: { code?: string; message: string }, fallback: string): never {
  if (error.code === 'P0002') throw new ChecklistNotFoundError(error.message)
  if (error.code === '42501') throw new ChecklistForbiddenError(error.message)
  if (error.code === '22023') throw new ChecklistValidationError(error.message)
  throw new Error(`${fallback}: ${error.message}`)
}

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

/** Şablonu (ve verildiyse maddelerini) tek işlemde yazar — SQL: save_checklist_template */
async function saveTemplate(
  templateId: string | null,
  storeId: string,
  actorId: string,
  input: ChecklistTemplateInput,
  replaceItems: boolean
): Promise<string> {
  const { data, error } = await db.rpc('save_checklist_template', {
    p_template_id: templateId,
    p_store_id: storeId,
    p_actor: actorId,
    p_name: input.name,
    p_kind: input.kind,
    p_weekdays: input.weekdays,
    p_due_time: input.due_time,
    p_active: input.active,
    p_items: replaceItems ? input.items : null,
    p_grace_mins: OVERDUE_GRACE_MINS,
  })
  if (error) throwRpcError(error, 'Kontrol listesi kaydedilemedi')
  return data as string
}

export async function createTemplate(
  input: ChecklistTemplateInput,
  storeId: string,
  actorId: string
): Promise<ChecklistTemplate> {
  const id = await saveTemplate(null, storeId, actorId, input, true)
  const created = await fetchTemplate(id, storeId)
  if (!created) throw new Error('Kontrol listesi oluşturuldu ancak okunamadı.')
  return created
}

/** Mevcut şablonla birleştirilmiş tam girdiyle günceller (kısmi PATCH desteği). */
export async function updateTemplate(
  id: string,
  patch: Record<string, unknown>,
  storeId: string,
  actorId: string
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

  await saveTemplate(id, storeId, actorId, input, patch.items !== undefined)

  const after = await fetchTemplate(id, storeId)
  if (!after) throw new ChecklistNotFoundError('Kontrol listesi bulunamadı.')
  return { before, after }
}

// ============================================================
// Günlük uygulamalar
// ============================================================

const RUN_COLUMNS = 'id, template_id, run_date, name, kind, due_time, completed_at, completed_by, note'

async function readRuns(storeId: string, dates: string[]): Promise<Row[]> {
  const { data, error } = await db.from('checklist_runs').select(RUN_COLUMNS).eq('store_id', storeId).in('run_date', dates)
  if (error) throw new Error(`Kontrol listesi uygulamaları yüklenemedi: ${error.message}`)
  return (data ?? []) as Row[]
}

/**
 * Bugünün uygulamalarını oluşturur (yoksa) ve görünür uygulamaları (bugün + 06:00'a kadar dün) döner.
 * Idempotent: UNIQUE(template_id, run_date) üzerinde ignoreDuplicates upsert. Maddesi olmayan şablon
 * için uygulama oluşmaz. Son saat + tolerans oluşturma anında geçmişse uygulama baştan "bildirildi"
 * işaretlenir (şablon gün içinde sonradan eklendi → yanlış gecikme alarmı yok; SQL ile aynı kural).
 * Eksik uygulama yoksa tek ek sorgu bile atılmaz (şablonlar + uygulamalar = 2 okuma).
 */
export async function ensureTodayRuns(storeId: string, nowMs: number): Promise<Row[]> {
  const { today, yesterday } = activeRunDates(nowMs)
  const dates = yesterday ? [yesterday, today] : [today]

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

  const runs = await readRuns(storeId, dates)
  const have = new Set(runs.filter((r) => r.run_date === today).map((r) => r.template_id as string))
  const missing = templatesMissingRun(templates, have, today)
  if (missing.length === 0) return runs

  const tItems = await fetchTemplateItems(missing.map((t) => t.id))
  const creatable = missing.filter((t) => tItems.some((i) => i.template_id === t.id))
  if (creatable.length === 0) return runs

  const nowIso = new Date(nowMs).toISOString()
  const rows = creatable.map((t) => ({
    store_id: storeId, template_id: t.id, run_date: today, name: t.name, kind: t.kind, due_time: t.due_time,
    overdue_notified_at: isRunOverdue({ run_date: today, due_time: t.due_time, completed_at: null }, nowMs) ? nowIso : null,
  }))
  const up = await db
    .from('checklist_runs')
    .upsert(rows, { onConflict: 'template_id,run_date', ignoreDuplicates: true })
    .select(RUN_COLUMNS)
  if (up.error) throw new Error(`Kontrol listesi uygulaması oluşturulamadı: ${up.error.message}`)
  const inserted = (up.data ?? []) as Row[]

  // Madde kopyası yalnızca bu istekte oluşan uygulamalara (başkası oluşturduysa o doldurur)
  const itemRows = inserted.flatMap((r) =>
    tItems
      .filter((i) => i.template_id === r.template_id)
      .map((i) => ({ run_id: r.id, position: i.position, text: i.text, required: i.required }))
  )
  if (itemRows.length > 0) {
    const ins = await db.from('checklist_run_items').upsert(itemRows, { onConflict: 'run_id,position', ignoreDuplicates: true })
    if (ins.error) throw new Error(`Liste maddeleri kopyalanamadı: ${ins.error.message}`)
  }

  // Yarışı kaybettiysek (başkası oluşturdu) güncel listeyi yeniden oku
  return inserted.length < rows.length ? readRuns(storeId, dates) : [...runs, ...inserted]
}

async function employeeNames(ids: (string | null)[], storeId: string): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  if (unique.length === 0) return new Map()
  const { data, error } = await db.from('employees').select('id, full_name').in('id', unique).eq('store_id', storeId)
  if (error) throw new Error(`Çalışanlar yüklenemedi: ${error.message}`)
  return new Map(((data ?? []) as Row[]).map((e) => [e.id as string, e.full_name as string]))
}

/**
 * Görünür uygulamalar (maddeleriyle): bugünküler + gece 06:00'a kadar dünün TAMAMLANMAMIŞ olanları.
 * Önce eksik uygulamaları oluşturur.
 */
export async function fetchTodayRuns(storeId: string, nowMs = Date.now()): Promise<ChecklistRun[]> {
  const { today } = activeRunDates(nowMs)
  const runs = (await ensureTodayRuns(storeId, nowMs)).filter((r) => r.run_date === today || !r.completed_at)
  if (runs.length === 0) return []

  const itemsRes = await db
    .from('checklist_run_items')
    .select('id, run_id, position, text, required, done_at, done_by')
    .in('run_id', runs.map((r) => r.id as string))
  if (itemsRes.error) throw new Error(`Liste maddeleri yüklenemedi: ${itemsRes.error.message}`)
  let items = (itemsRes.data ?? []) as Row[]

  // Yarışta oluşmuş ama maddeleri henüz kopyalanmamış uygulamayı tamamla (idempotent)
  const filled = new Set(items.map((i) => i.run_id as string))
  const empty = runs.filter((r) => !filled.has(r.id as string))
  if (empty.length > 0) {
    const tItems = await fetchTemplateItems(empty.map((r) => r.template_id as string))
    const rows = empty.flatMap((r) =>
      tItems.filter((i) => i.template_id === r.template_id)
        .map((i) => ({ run_id: r.id, position: i.position, text: i.text, required: i.required }))
    )
    if (rows.length > 0) {
      const ins = await db.from('checklist_run_items').upsert(rows, { onConflict: 'run_id,position', ignoreDuplicates: true })
      if (ins.error) throw new Error(`Liste maddeleri kopyalanamadı: ${ins.error.message}`)
      const again = await db
        .from('checklist_run_items')
        .select('id, run_id, position, text, required, done_at, done_by')
        .in('run_id', empty.map((r) => r.id as string))
      if (again.error) throw new Error(`Liste maddeleri yüklenemedi: ${again.error.message}`)
      items = [...items, ...((again.data ?? []) as Row[])]
    }
  }

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
    .sort((a, b) => a.run_date.localeCompare(b.run_date) || kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name, 'tr'))
}

const kindRank = (k: ChecklistKind) => (k === 'opening' ? 0 : k === 'custom' ? 1 : 2)

/**
 * Çalışanın bu mağazada işaretleme hakkı veren vardiyası var mı? (bugün izinli olmayan vardiya ya da
 * dünden başlayıp gece yarısını geçen ve henüz bitmemiş vardiya)
 */
export async function hasTickableShift(employeeId: string, storeId: string, nowMs = Date.now()): Promise<boolean> {
  const { today, yesterday } = activeRunDates(nowMs)
  const dates = yesterday ? [yesterday, today] : [today]
  // Dün yalnızca 06:00'a kadar anlamlı (gece vardiyası); sonrasında sadece bugün
  const { data, error } = await db
    .from('shift_assignments')
    .select('work_date, start_time, end_time, is_on_leave')
    .eq('employee_id', employeeId)
    .eq('store_id', storeId)
    .in('work_date', dates)
  if (error) throw new Error(`Vardiya sorgulanamadı: ${error.message}`)
  return ((data ?? []) as Row[]).some((s) =>
    shiftGrantsTick(
      { work_date: s.work_date as string, start_time: String(s.start_time ?? ''), end_time: String(s.end_time ?? ''), is_on_leave: s.is_on_leave as boolean | null },
      nowMs
    )
  )
}

/** Uygulama bu mağazaya ait mi? Değilse ChecklistNotFoundError */
async function getRunInStore(runId: string, storeId: string): Promise<Row> {
  const { data, error } = await db
    .from('checklist_runs')
    .select('id, store_id, run_date')
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

/** İşaretleme yetkisini doğrular (yönetici ya da bu mağazada geçerli vardiyası olan) */
async function assertCanTick(actor: Actor, storeId: string, nowMs: number): Promise<void> {
  const hasShift = actor.isManager ? false : await hasTickableShift(actor.id, storeId, nowMs)
  if (!canTickChecklist({ isManager: actor.isManager, hasShiftTodayInStore: hasShift })) {
    throw new ChecklistForbiddenError('Kontrol listesini yalnızca bugün bu mağazada vardiyası olanlar işaretleyebilir.')
  }
}

/**
 * Maddeyi işaretler / geri alır. Düzenleme penceresi: bugünün uygulaması; dünün uygulaması 06:00'a kadar.
 * İşaretleme: yönetici ya da geçerli vardiyası olan çalışan (burada denetlenir). Geri alma sahipliği,
 * pencere ve tamamlanma durumunun yeniden hesabı tek işlemde SQL'de yapılır (set_checklist_item).
 */
export async function setItemDone(args: {
  runId: string
  itemId: string
  done: boolean
  actor: Actor
  storeId: string
  nowMs?: number
}): Promise<{ item: { id: string; done_at: string | null; done_by: string | null }; completed_at: string | null; completed_by: string | null }> {
  const { runId, itemId, done, actor, storeId } = args
  const nowMs = args.nowMs ?? Date.now()
  const run = await getRunInStore(runId, storeId)
  if (!isRunEditable(run.run_date as string, nowMs)) {
    throw new ChecklistForbiddenError('Bu kontrol listesi artık düzenlenemez.')
  }
  if (done) await assertCanTick(actor, storeId, nowMs)

  const { data, error } = await db.rpc('set_checklist_item', {
    p_run_id: runId,
    p_item_id: itemId,
    p_store_id: storeId,
    p_done: done,
    p_actor: actor.id,
    p_is_manager: actor.isManager,
  })
  if (error) throwRpcError(error, 'Madde güncellenemedi')
  const r = data as { done_at: string | null; done_by: string | null; completed_at: string | null; completed_by: string | null }
  return { item: { id: itemId, done_at: r.done_at, done_by: r.done_by }, completed_at: r.completed_at, completed_by: r.completed_by }
}

/** Uygulamaya serbest not yazar (aynı düzenleme penceresi ve işaretleme yetkisi) */
export async function setRunNote(args: {
  runId: string
  note: string | null
  actor: Actor
  storeId: string
  nowMs?: number
}): Promise<string | null> {
  const { runId, actor, storeId } = args
  const nowMs = args.nowMs ?? Date.now()
  const note = args.note?.trim() ? args.note.trim() : null
  if (note && note.length > MAX_NOTE) throw new ChecklistValidationError(`Not en fazla ${MAX_NOTE} karakter olabilir.`)
  const run = await getRunInStore(runId, storeId)
  if (!isRunEditable(run.run_date as string, nowMs)) throw new ChecklistForbiddenError('Bu kontrol listesi artık düzenlenemez.')
  await assertCanTick(actor, storeId, nowMs)
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
