// @vitest-environment node
/**
 * checklistsApi.test.ts — kontrol listeleri API'si: tembel uygulama oluşturma (idempotent, gün
 * uygunluğu), şablon snapshot'ı, tamamlanma, kim işaretleyebilir / geri alabilir, şablon yetkisi,
 * mağaza izolasyonu, hız limiti. Oturum mock'lanır; veri bellek içi fake Supabase ile çalışır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS, type AccessLevel } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const STORE_A = '00000000-0000-0000-0003-00000000000a'
const STORE_B = '00000000-0000-0000-0003-00000000000b'
const TPL_A = '11111111-1111-4111-8111-111111111111'
const TPL_B = '22222222-2222-4222-8222-222222222222'
const EMP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const EMP_A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const EMP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const EMP_NOSHIFT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MGR_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

// 2026-10-28 Çarşamba (3), Europe/Istanbul 09:00
const NOW = new Date('2026-10-28T09:00:00+03:00')
const TODAY = '2026-10-28'

const base = { email: null, role_id: null, role_name: null, active: true }
const emp = (id: string, store: string, level: AccessLevel = ACCESS.EMPLOYEE) => ({
  ...base, id, full_name: `Kişi ${id.slice(0, 2)}`, access_level: level, home_store_id: store, store_id: store,
})

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown, rate: { allowed: true } }))
const logAudit = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => state.db }))
vi.mock('@/lib/db', () => ({ db: new Proxy({}, { get: (_t, p) => (state.db as Record<string | symbol, unknown>)[p] }) }))
vi.mock('@/lib/auditLog', () => ({ logAudit }))
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: state.rate.allowed, remaining: 1, resetAt: 0 })),
}))

let db: FakeDb
const UNIQUE = {
  checklist_runs: [['template_id', 'run_date']],
  checklist_run_items: [['run_id', 'position']],
}

function seed(extra: Record<string, Record<string, unknown>[]> = {}) {
  db = createFakeDb({
    employees: [
      { id: EMP_A, full_name: 'Ali', store_id: STORE_A },
      { id: EMP_A2, full_name: 'Veli', store_id: STORE_A },
      { id: EMP_NOSHIFT, full_name: 'Can', store_id: STORE_A },
      { id: EMP_B, full_name: 'Bora', store_id: STORE_B },
      { id: MGR_A, full_name: 'Müdire', store_id: STORE_A },
    ],
    shift_assignments: [
      { id: 's1', employee_id: EMP_A, store_id: STORE_A, work_date: TODAY, is_on_leave: false },
      { id: 's2', employee_id: EMP_A2, store_id: STORE_A, work_date: TODAY, is_on_leave: false },
      // EMP_B bu mağazada değil, kendi mağazasında vardiyalı
      { id: 's3', employee_id: EMP_B, store_id: STORE_B, work_date: TODAY, is_on_leave: false },
    ],
    checklist_templates: [
      { id: TPL_A, store_id: STORE_A, name: 'Açılış', kind: 'opening', weekdays: [0, 1, 2, 3, 4, 5, 6], due_time: '10:00:00', active: true },
      { id: TPL_B, store_id: STORE_B, name: 'B Açılış', kind: 'opening', weekdays: [0, 1, 2, 3, 4, 5, 6], due_time: null, active: true },
    ],
    checklist_template_items: [
      { id: 'ti1', template_id: TPL_A, position: 0, text: 'Kasayı aç', required: true },
      { id: 'ti2', template_id: TPL_A, position: 1, text: 'Işıkları yak', required: true },
      { id: 'ti3', template_id: TPL_A, position: 2, text: 'Müzik (opsiyonel)', required: false },
      { id: 'ti4', template_id: TPL_B, position: 0, text: 'B maddesi', required: true },
    ],
    checklist_runs: [],
    checklist_run_items: [],
    ...extra,
  }, { unique: UNIQUE })
  state.db = db
}

const asUser = (e: unknown) => { state.employee = e }

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })

async function today() {
  const { GET } = await import('@/app/api/checklists/today/route')
  const res = await GET(new NextRequest('http://localhost/api/checklists/today'))
  return { res, body: (await res.json()) as {
    runs: { id: string; name: string; items: { id: string; text: string; done_by: string | null }[]; completed_at: string | null; overdue: boolean }[]
    can_tick: boolean; is_manager: boolean
  } }
}

async function tick(runId: string, itemId: string, done: boolean) {
  const { PATCH } = await import('@/app/api/checklists/runs/[id]/items/[itemId]/route')
  return PATCH(json(`/api/checklists/runs/${runId}/items/${itemId}`, 'PATCH', { done }), { params: Promise.resolve({ id: runId, itemId }) })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  state.rate.allowed = true
  seed()
  asUser(emp(EMP_A, STORE_A))
})
afterEach(() => vi.useRealTimers())

describe('GET /api/checklists/today — tembel oluşturma', () => {
  it('bugünün uygulamasını ve madde kopyasını oluşturur; ikinci okuma yenisini oluşturmaz (idempotent)', async () => {
    const first = await today()
    expect(first.res.status).toBe(200)
    expect(first.body.runs).toHaveLength(1)
    expect(first.body.runs[0].items.map((i) => i.text)).toEqual(['Kasayı aç', 'Işıkları yak', 'Müzik (opsiyonel)'])

    const second = await today()
    expect(second.body.runs[0].id).toBe(first.body.runs[0].id)
    expect(db.tables.checklist_runs).toHaveLength(1)
    expect(db.tables.checklist_run_items).toHaveLength(3)
  })

  it('başka mağazanın şablonundan uygulama oluşturmaz', async () => {
    await today()
    expect(db.tables.checklist_runs.every((r) => r.store_id === STORE_A)).toBe(true)
  })

  it('haftanın günü uymayan ve pasif şablon için uygulama oluşturmaz', async () => {
    seed({
      checklist_templates: [
        { id: TPL_A, store_id: STORE_A, name: 'Pazartesi', kind: 'custom', weekdays: [1], due_time: null, active: true },
        { id: TPL_B, store_id: STORE_A, name: 'Pasif', kind: 'custom', weekdays: [3], due_time: null, active: false },
      ],
    })
    const { body } = await today()
    expect(body.runs).toHaveLength(0)
    expect(db.tables.checklist_runs).toHaveLength(0)
  })

  it('yarışta oluşmuş (maddesiz) uygulamanın madde kopyasını tamamlar', async () => {
    seed({ checklist_runs: [{ id: 'run-x', store_id: STORE_A, template_id: TPL_A, run_date: TODAY, name: 'Açılış', kind: 'opening', due_time: '10:00:00', completed_at: null }] })
    const { body } = await today()
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0].items).toHaveLength(3)
    expect(db.tables.checklist_runs).toHaveLength(1)
  })

  it('geciken listeyi işaretler (10:00 + 15 dk)', async () => {
    vi.setSystemTime(new Date('2026-10-28T10:20:00+03:00'))
    expect((await today()).body.runs[0].overdue).toBe(true)
  })

  it('can_tick: bugün vardiyası olan true, olmayan false, yönetici true', async () => {
    expect((await today()).body.can_tick).toBe(true)
    asUser(emp(EMP_NOSHIFT, STORE_A))
    expect((await today()).body.can_tick).toBe(false)
    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    const m = await today()
    expect(m.body.can_tick).toBe(true)
    expect(m.body.is_manager).toBe(true)
  })

  it('oturum yoksa 401', async () => {
    asUser(null)
    expect((await today()).res.status).toBe(401)
  })
})

describe('snapshot bağımsızlığı', () => {
  it('şablon sonradan düzenlense de oluşmuş uygulamanın metinleri değişmez', async () => {
    const first = await today()
    const runId = first.body.runs[0].id

    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    const { PATCH } = await import('@/app/api/checklists/templates/[id]/route')
    const res = await PATCH(
      json(`/api/checklists/templates/${TPL_A}`, 'PATCH', { name: 'Yeni ad', items: [{ text: 'Tamamen yeni madde', required: true }] }),
      { params: Promise.resolve({ id: TPL_A }) }
    )
    expect(res.status).toBe(200)

    const after = await today()
    const run = after.body.runs.find((r) => r.id === runId)!
    expect(run.name).toBe('Açılış')
    expect(run.items.map((i) => i.text)).toEqual(['Kasayı aç', 'Işıkları yak', 'Müzik (opsiyonel)'])
    // Şablonun kendisi güncellendi
    expect(db.tables.checklist_template_items.filter((i) => i.template_id === TPL_A).map((i) => i.text)).toEqual(['Tamamen yeni madde'])
  })
})

describe('PATCH items — işaretleme', () => {
  it('vardiyası olan çalışan işaretler; zorunlular bitince liste tamamlanır, opsiyonel beklenmez', async () => {
    const { body } = await today()
    const run = body.runs[0]
    expect((await tick(run.id, run.items[0].id, true)).status).toBe(200)
    expect((await today()).body.runs[0].completed_at).toBeNull()
    const res = await tick(run.id, run.items[1].id, true)
    const r = (await res.json()) as { completed_at: string | null }
    expect(r.completed_at).not.toBeNull()
    const stored = db.tables.checklist_runs[0]
    expect(stored.completed_by).toBe(EMP_A)
    expect(db.tables.checklist_run_items.find((i) => i.id === run.items[0].id)?.done_by).toBe(EMP_A)
    expect(logAudit).not.toHaveBeenCalled() // tikler denetim kaydına yazılmaz
  })

  it('zorunlu madde geri alınınca liste yeniden açılır', async () => {
    const run = (await today()).body.runs[0]
    await tick(run.id, run.items[0].id, true)
    await tick(run.id, run.items[1].id, true)
    await tick(run.id, run.items[1].id, false)
    expect(db.tables.checklist_runs[0].completed_at).toBeNull()
    expect(db.tables.checklist_runs[0].completed_by).toBeNull()
  })

  it('bugün hiç vardiyası olmayan aynı mağaza çalışanı 403', async () => {
    const run = (await today()).body.runs[0]
    asUser(emp(EMP_NOSHIFT, STORE_A))
    expect((await tick(run.id, run.items[0].id, true)).status).toBe(403)
  })

  it('izinli (is_on_leave) vardiya işaretleme hakkı vermez', async () => {
    const run = (await today()).body.runs[0]
    db.tables.shift_assignments.find((s) => s.id === 's1')!.is_on_leave = true
    expect((await tick(run.id, run.items[0].id, true)).status).toBe(403)
  })

  it('başka mağazanın çalışanı (kendi mağazasında vardiyalı) bu mağazanın listesini 404 ile görür', async () => {
    const run = (await today()).body.runs[0]
    asUser(emp(EMP_B, STORE_B))
    expect((await tick(run.id, run.items[0].id, true)).status).toBe(404)
  })

  it('yönetici vardiyası olmasa da işaretler', async () => {
    const run = (await today()).body.runs[0]
    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    expect((await tick(run.id, run.items[0].id, true)).status).toBe(200)
  })

  it('başka mağazanın maddesi / bu uygulamaya ait olmayan madde 404', async () => {
    const run = (await today()).body.runs[0]
    // B mağazasının uygulamasını oluştur
    asUser(emp(EMP_B, STORE_B))
    const bRun = (await today()).body.runs[0]
    asUser(emp(EMP_A, STORE_A))
    expect((await tick(run.id, bRun.items[0].id, true)).status).toBe(404)
    expect((await tick(bRun.id, bRun.items[0].id, true)).status).toBe(404)
  })

  it('geçersiz id / gövde 400', async () => {
    const { PATCH } = await import('@/app/api/checklists/runs/[id]/items/[itemId]/route')
    expect((await PATCH(json('/x', 'PATCH', { done: true }), { params: Promise.resolve({ id: 'x', itemId: 'y' }) })).status).toBe(400)
    const run = (await today()).body.runs[0]
    const res = await PATCH(json('/x', 'PATCH', { done: 'evet' }), { params: Promise.resolve({ id: run.id, itemId: run.items[0].id }) })
    expect(res.status).toBe(400)
  })

  it('hız limiti aşılınca 429', async () => {
    const run = (await today()).body.runs[0]
    state.rate.allowed = false
    expect((await tick(run.id, run.items[0].id, true)).status).toBe(429)
  })
})

describe('geri alma kuralları', () => {
  it('başkasının işaretini çalışan geri alamaz; işaretleyen ve yönetici alabilir', async () => {
    const run = (await today()).body.runs[0]
    const itemId = run.items[0].id
    await tick(run.id, itemId, true) // EMP_A işaretledi

    asUser(emp(EMP_A2, STORE_A))
    expect((await tick(run.id, itemId, false)).status).toBe(403)
    expect(db.tables.checklist_run_items.find((i) => i.id === itemId)?.done_at).toBeTruthy()

    asUser(emp(EMP_A, STORE_A))
    expect((await tick(run.id, itemId, false)).status).toBe(200)

    await tick(run.id, itemId, true)
    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    expect((await tick(run.id, itemId, false)).status).toBe(200)
  })

  it('geçmiş günün uygulaması değiştirilemez', async () => {
    seed({
      checklist_runs: [{ id: '33333333-3333-4333-8333-333333333333', store_id: STORE_A, template_id: TPL_A, run_date: '2026-10-27', name: 'Açılış', kind: 'opening', completed_at: null }],
      checklist_run_items: [{ id: '44444444-4444-4444-8444-444444444444', run_id: '33333333-3333-4333-8333-333333333333', position: 0, text: 'x', required: true, done_at: null }],
    })
    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    expect((await tick('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', true)).status).toBe(403)
  })
})

describe('PATCH run — not', () => {
  it('yetkili not yazar; yetkisiz 403; 500+ karakter 400', async () => {
    const run = (await today()).body.runs[0]
    const { PATCH } = await import('@/app/api/checklists/runs/[id]/route')
    const call = (note: unknown) => PATCH(json('/x', 'PATCH', { note }), { params: Promise.resolve({ id: run.id }) })
    expect((await call('Fiş bitti')).status).toBe(200)
    expect(db.tables.checklist_runs[0].note).toBe('Fiş bitti')
    expect((await call('a'.repeat(501))).status).toBe(400)
    asUser(emp(EMP_NOSHIFT, STORE_A))
    expect((await call('x')).status).toBe(403)
  })
})

describe('şablon API yetkisi ve mağaza izolasyonu', () => {
  const valid = { name: 'Kapanış', kind: 'closing', due_time: '22:30', items: [{ text: 'Kasa say', required: true }] }

  it('çalışan şablon listeleyemez / oluşturamaz / güncelleyemez (403)', async () => {
    const t = await import('@/app/api/checklists/templates/route')
    const id = await import('@/app/api/checklists/templates/[id]/route')
    const h = await import('@/app/api/checklists/history/route')
    expect((await t.GET(new NextRequest('http://localhost/api/checklists/templates'))).status).toBe(403)
    expect((await t.POST(json('/api/checklists/templates', 'POST', valid))).status).toBe(403)
    expect((await id.PATCH(json('/x', 'PATCH', { active: false }), { params: Promise.resolve({ id: TPL_A }) })).status).toBe(403)
    expect((await h.GET(new NextRequest('http://localhost/api/checklists/history'))).status).toBe(403)
  })

  it('yönetici oluşturur (aktif mağazaya), denetim kaydı yazılır', async () => {
    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    const { POST } = await import('@/app/api/checklists/templates/route')
    const res = await POST(json('/api/checklists/templates', 'POST', valid))
    expect(res.status).toBe(201)
    const created = db.tables.checklist_templates.find((t) => t.name === 'Kapanış')!
    expect(created.store_id).toBe(STORE_A)
    expect(created.due_time).toBe('22:30')
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'checklist.template_create', storeId: STORE_A }))
  })

  it('geçersiz gövde 400', async () => {
    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    const { POST } = await import('@/app/api/checklists/templates/route')
    expect((await POST(json('/x', 'POST', { ...valid, items: [] }))).status).toBe(400)
  })

  it('yönetici başka mağazanın şablonunu güncelleyemez (404) ve liste yalnızca kendi mağazasını gösterir', async () => {
    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    const id = await import('@/app/api/checklists/templates/[id]/route')
    const res = await id.PATCH(json('/x', 'PATCH', { active: false }), { params: Promise.resolve({ id: TPL_B }) })
    expect(res.status).toBe(404)
    expect(db.tables.checklist_templates.find((t) => t.id === TPL_B)?.active).toBe(true)

    const { GET } = await import('@/app/api/checklists/templates/route')
    const list = (await (await GET(new NextRequest('http://localhost/api/checklists/templates'))).json()) as { templates: { id: string }[] }
    expect(list.templates.map((t) => t.id)).toEqual([TPL_A])
  })

  it('kısmi PATCH (active) güncelleme yapar ve denetim kaydı yazar', async () => {
    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    const id = await import('@/app/api/checklists/templates/[id]/route')
    const res = await id.PATCH(json('/x', 'PATCH', { active: false }), { params: Promise.resolve({ id: TPL_A }) })
    expect(res.status).toBe(200)
    expect(db.tables.checklist_templates.find((t) => t.id === TPL_A)?.active).toBe(false)
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'checklist.template_update', entityId: TPL_A }))
  })

  it('geçmiş yalnızca aktif mağazanın uygulamalarını içerir', async () => {
    await today()
    asUser(emp(EMP_B, STORE_B))
    await today()
    asUser(emp(MGR_A, STORE_A, ACCESS.MANAGER))
    const { GET } = await import('@/app/api/checklists/history/route')
    const body = (await (await GET(new NextRequest('http://localhost/api/checklists/history'))).json()) as { runs: { template_id: string; total: number }[] }
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0]).toMatchObject({ template_id: TPL_A, total: 3 })
  })
})
