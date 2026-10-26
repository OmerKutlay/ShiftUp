/**
 * storeScopePlanning.test.ts — çoklu mağaza: planlama uçlarında mağazalar arası izolasyon.
 * Vardiya, şablon, plan aktarımı (workforce), açık vardiya ve üstlenme; oturumun aktif mağazası
 * dışındaki kayıt görünmez, değiştirilemez, silinemez. Veri bellek içi fake Supabase ile çalışır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const STORE_A = '00000000-0000-0000-0003-000000000001'
const STORE_B = '00000000-0000-0000-0003-000000000002'
const uid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`

// Çalışanlar: A mağazası (1,2), B mağazası (3)
const EMP_A1 = uid(1)
const EMP_A2 = uid(2)
const EMP_B1 = uid(3)
const MGR_A = uid(10)
const MGR_B = uid(11)
// Şablonlar
const TPL_A = uid(21)
const TPL_B = uid(22)
// Vardiyalar / açık vardiyalar
const SHIFT_A = uid(31)
const SHIFT_B = uid(32)
const OPEN_A = uid(41)
const OPEN_B = uid(42)

/** Gelecek bir hafta (Pzt 2030-03-04) — geçmiş gün korumaları devreye girmesin */
const WEEK_START = '2030-03-04'
const TUE = '2030-03-05'
const WED = '2030-03-06'

const session = (overrides: Record<string, unknown> = {}) => ({
  id: MGR_A, full_name: 'Müdür A', email: 'a@example.com', role_id: null, role_name: null,
  active: true, access_level: ACCESS.STORE_MANAGER, home_store_id: STORE_A, store_id: STORE_A,
  ...overrides,
})

function seed() {
  return {
    employees: [
      { id: EMP_A1, full_name: 'Ali', store_id: STORE_A, active: true, employment_type: 'full_time', birth_date: null, roles: { planning_group: 'cashier', name: 'Kasiyer', access_level: ACCESS.EMPLOYEE } },
      { id: EMP_A2, full_name: 'Ayşe', store_id: STORE_A, active: true, employment_type: 'full_time', birth_date: null, roles: { planning_group: 'sales', name: 'Satış', access_level: ACCESS.EMPLOYEE } },
      { id: EMP_B1, full_name: 'Burak', store_id: STORE_B, active: true, employment_type: 'full_time', birth_date: null, roles: { planning_group: 'cashier', name: 'Kasiyer', access_level: ACCESS.EMPLOYEE } },
      { id: MGR_A, full_name: 'Müdür A', store_id: STORE_A, active: true, employment_type: 'full_time', birth_date: null, roles: { planning_group: 'store_manager', name: 'Müdür', access_level: ACCESS.STORE_MANAGER } },
      { id: MGR_B, full_name: 'Müdür B', store_id: STORE_B, active: true, employment_type: 'full_time', birth_date: null, roles: { planning_group: 'store_manager', name: 'Müdür', access_level: ACCESS.STORE_MANAGER } },
    ],
    shift_templates: [
      { id: TPL_A, store_id: STORE_A, name: 'Açılış', start_time: '10:00:00', end_time: '19:00:00', description: null, active: true },
      { id: TPL_B, store_id: STORE_B, name: 'Açılış', start_time: '09:00:00', end_time: '18:00:00', description: null, active: true },
    ],
    shift_assignments: [
      { id: SHIFT_A, store_id: STORE_A, employee_id: EMP_A1, work_date: TUE, start_time: '10:00', end_time: '19:00', shift_template_id: TPL_A, is_on_leave: false },
      { id: SHIFT_B, store_id: STORE_B, employee_id: EMP_B1, work_date: TUE, start_time: '09:00', end_time: '18:00', shift_template_id: TPL_B, is_on_leave: false },
    ],
    open_shifts: [
      { id: OPEN_A, store_id: STORE_A, work_date: TUE, start_time: '10:00:00', end_time: '19:00:00', role_needed: null, description: null, status: 'open' },
      { id: OPEN_B, store_id: STORE_B, work_date: TUE, start_time: '10:00:00', end_time: '19:00:00', role_needed: null, description: null, status: 'open' },
    ],
    leave_requests: [],
    attendance_records: [],
    employee_availability: [],
    public_holidays: [],
    notifications: [],
    audit_logs: [],
  }
}

const FAKE_OPTIONS = {
  unique: {
    shift_templates: [['store_id', 'name']],
    shift_assignments: [['employee_id', 'work_date']],
  },
}

function setup(employee: unknown, db: FakeDb) {
  vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(employee) }))
  vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
  vi.doMock('@/lib/db', () => ({ db }))
}

const jsonReq = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => vi.resetModules())

// ─── Vardiyalar ──────────────────────────────────────────────
describe('/api/shifts — mağaza izolasyonu', () => {
  it('GET yalnızca aktif mağazanın vardiyalarını listeler', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { GET } = await import('@/app/api/shifts/route')
    const res = await GET(jsonReq(`http://localhost/api/shifts?week=${WEEK_START}`, 'GET'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { assignments: { id: string }[] }
    expect(body.assignments.map((a) => a.id)).toEqual([SHIFT_A])

    // Aralık sorgusu da aynı kapsamda
    const range = await GET(jsonReq(`http://localhost/api/shifts?start=${WEEK_START}&end=${WED}`, 'GET'))
    expect(((await range.json()) as { assignments: { id: string }[] }).assignments.map((a) => a.id)).toEqual([SHIFT_A])
  })

  it('GET: B mağazası oturumu A vardiyasını görmez', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session({ id: MGR_B, home_store_id: STORE_B, store_id: STORE_B }), db)
    const { GET } = await import('@/app/api/shifts/route')
    const res = await GET(jsonReq(`http://localhost/api/shifts?week=${WEEK_START}`, 'GET'))
    expect(((await res.json()) as { assignments: { id: string }[] }).assignments.map((a) => a.id)).toEqual([SHIFT_B])
  })

  it('POST başka mağazanın çalışanına vardiya atamayı reddeder (404)', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/shifts/route')
    const res = await POST(jsonReq('http://localhost/api/shifts', 'POST', {
      employee_id: EMP_B1, work_date: WED, start_time: '10:00', end_time: '19:00',
    }))
    expect(res.status).toBe(404)
    expect(db.tables.shift_assignments).toHaveLength(2)
  })

  it('POST başka mağazanın şablonunu reddeder (400)', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/shifts/route')
    const res = await POST(jsonReq('http://localhost/api/shifts', 'POST', {
      employee_id: EMP_A2, shift_template_id: TPL_B, work_date: WED, start_time: '10:00', end_time: '19:00',
    }))
    expect(res.status).toBe(400)
    expect(db.tables.shift_assignments).toHaveLength(2)
  })

  it('POST kendi mağazasının çalışanına store_id ile vardiya ekler ve denetim kaydına mağazayı yazar', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/shifts/route')
    const res = await POST(jsonReq('http://localhost/api/shifts', 'POST', {
      employee_id: EMP_A2, shift_template_id: TPL_A, work_date: WED, start_time: '10:00', end_time: '19:00',
    }))
    expect(res.status).toBe(201)
    const created = db.tables.shift_assignments.find((r) => r.employee_id === EMP_A2)
    expect(created).toMatchObject({ store_id: STORE_A, work_date: WED })
    expect(db.tables.audit_logs[0]).toMatchObject({ action: 'shift.create', store_id: STORE_A })
  })

  it('PATCH başka mağazanın vardiyasını güncellemez (404)', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { PATCH } = await import('@/app/api/shifts/[id]/route')
    const res = await PATCH(
      jsonReq(`http://localhost/api/shifts/${SHIFT_B}`, 'PATCH', { start_time: '11:00', end_time: '20:00' }),
      ctx(SHIFT_B)
    )
    expect(res.status).toBe(404)
    expect(db.tables.shift_assignments.find((r) => r.id === SHIFT_B)).toMatchObject({ start_time: '09:00' })
  })

  it('PATCH kendi mağazasının vardiyasını günceller; başka mağaza şablonu reddedilir', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { PATCH } = await import('@/app/api/shifts/[id]/route')
    const bad = await PATCH(
      jsonReq(`http://localhost/api/shifts/${SHIFT_A}`, 'PATCH', { shift_template_id: TPL_B }),
      ctx(SHIFT_A)
    )
    expect(bad.status).toBe(400)
    const ok = await PATCH(
      jsonReq(`http://localhost/api/shifts/${SHIFT_A}`, 'PATCH', { start_time: '11:00', end_time: '20:00' }),
      ctx(SHIFT_A)
    )
    expect(ok.status).toBe(200)
    expect(db.tables.shift_assignments.find((r) => r.id === SHIFT_A)).toMatchObject({ start_time: '11:00', end_time: '20:00' })
  })

  it('DELETE başka mağazanın vardiyasını silmez (404)', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { DELETE } = await import('@/app/api/shifts/[id]/route')
    const res = await DELETE(jsonReq(`http://localhost/api/shifts/${SHIFT_B}`, 'DELETE'), ctx(SHIFT_B))
    expect(res.status).toBe(404)
    expect(db.tables.shift_assignments.map((r) => r.id).sort()).toEqual([SHIFT_A, SHIFT_B].sort())

    const own = await DELETE(jsonReq(`http://localhost/api/shifts/${SHIFT_A}`, 'DELETE'), ctx(SHIFT_A))
    expect(own.status).toBe(200)
    expect(db.tables.shift_assignments.map((r) => r.id)).toEqual([SHIFT_B])
  })
})

// ─── Şablonlar ───────────────────────────────────────────────
describe('/api/shift-templates — mağaza izolasyonu', () => {
  it('GET yalnızca aktif mağazanın şablonlarını listeler', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { GET } = await import('@/app/api/shift-templates/route')
    for (const url of ['http://localhost/api/shift-templates', 'http://localhost/api/shift-templates?active=true']) {
      const res = await GET(jsonReq(url, 'GET'))
      const body = (await res.json()) as { templates: { id: string }[] }
      expect(body.templates.map((t) => t.id)).toEqual([TPL_A])
    }
  })

  it('POST şablonu store_id ile oluşturur; aynı ad başka mağazada serbest, aynı mağazada 400', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/shift-templates/route')
    const payload = (name: string) => ({ name, start_time: '12:00', end_time: '21:00' })

    // "Açılış" B mağazasında zaten var → A için farklı ad: serbest; A'da var olan ad: çakışma
    const ok = await POST(jsonReq('http://localhost/api/shift-templates', 'POST', payload('Ara')))
    expect(ok.status).toBe(201)
    expect(db.tables.shift_templates.find((t) => t.name === 'Ara')).toMatchObject({ store_id: STORE_A })

    const dup = await POST(jsonReq('http://localhost/api/shift-templates', 'POST', payload('Açılış')))
    expect(dup.status).toBe(400)

    // B mağazası oturumu, A'da bulunan "Ara" adını kendi mağazasında kullanabilir
    vi.resetModules()
    setup(session({ id: MGR_B, home_store_id: STORE_B, store_id: STORE_B }), db)
    const { POST: POST_B } = await import('@/app/api/shift-templates/route')
    const okB = await POST_B(jsonReq('http://localhost/api/shift-templates', 'POST', payload('Ara')))
    expect(okB.status).toBe(201)
    expect(db.tables.shift_templates.filter((t) => t.name === 'Ara').map((t) => t.store_id).sort()).toEqual([STORE_A, STORE_B])
  })

  it('PATCH başka mağazanın şablonunu güncellemez (404)', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { PATCH } = await import('@/app/api/shift-templates/[id]/route')
    const res = await PATCH(
      jsonReq(`http://localhost/api/shift-templates/${TPL_B}`, 'PATCH', { active: false }),
      ctx(TPL_B)
    )
    expect(res.status).toBe(404)
    expect(db.tables.shift_templates.find((t) => t.id === TPL_B)).toMatchObject({ active: true })

    const own = await PATCH(
      jsonReq(`http://localhost/api/shift-templates/${TPL_A}`, 'PATCH', { active: false }),
      ctx(TPL_A)
    )
    expect(own.status).toBe(200)
    expect(db.tables.shift_templates.find((t) => t.id === TPL_A)).toMatchObject({ active: false })
  })
})

// ─── Workforce ───────────────────────────────────────────────
describe('/api/workforce — mağaza izolasyonu', () => {
  it('apply yalnızca aktif mağazanın haftalık planını değiştirir; diğer mağazanın vardiyası ve tatili korunur', async () => {
    const data = seed()
    // Her iki mağazada aynı haftada otomatik haftalık tatil kaydı
    const autoRest = (employee_id: string, d: string) => ({
      id: `rest-${employee_id}-${d}`, employee_id, leave_type: 'weekly_rest', start_date: d, end_date: d,
      reason: 'Otomatik haftalık tatil', status: 'approved',
    })
    const { AUTO_WEEKLY_REST_REASON } = await import('@/types/leave')
    const rests = [autoRest(EMP_A2, WED), autoRest(EMP_B1, WED)].map((r) => ({ ...r, reason: AUTO_WEEKLY_REST_REASON }))
    const db = createFakeDb({ ...data, leave_requests: rests }, FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/workforce/apply/route')
    const res = await POST(jsonReq('http://localhost/api/workforce/apply', 'POST', {
      weekStart: WEEK_START,
      acknowledge_violations: true,
      assignments: [
        { employee_id: EMP_A1, work_date: WED, start_time: '10:00', end_time: '19:00', shift_template_id: TPL_A },
      ],
    }))
    expect(res.status).toBe(200)

    const shifts = db.tables.shift_assignments
    // B mağazasının vardiyası dokunulmadı
    expect(shifts.find((s) => s.id === SHIFT_B)).toBeTruthy()
    // A mağazasının eski vardiyası değiştirildi, yenisi store_id ile yazıldı
    expect(shifts.find((s) => s.id === SHIFT_A)).toBeUndefined()
    const created = shifts.filter((s) => s.employee_id === EMP_A1)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ store_id: STORE_A, work_date: WED })

    // B çalışanının otomatik tatili silinmedi ve A planı için B çalışanına tatil yazılmadı
    const leaves = db.tables.leave_requests
    expect(leaves.find((l) => l.employee_id === EMP_B1 && l.start_date === WED)?.id).toBe(`rest-${EMP_B1}-${WED}`)
    expect(leaves.filter((l) => l.employee_id === EMP_B1)).toHaveLength(1)
    // A çalışanı için yeni otomatik tatiller yazıldı
    expect(leaves.filter((l) => l.employee_id === EMP_A1 && l.leave_type === 'weekly_rest').length).toBeGreaterThan(0)
    expect(db.tables.audit_logs.find((l) => l.action === 'workforce.apply')).toMatchObject({ store_id: STORE_A })
  })

  it('apply taslağında başka mağazanın çalışanı veya şablonu varsa 400 döner ve hiçbir şey değişmez', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/workforce/apply/route')
    const foreignEmployee = await POST(jsonReq('http://localhost/api/workforce/apply', 'POST', {
      weekStart: WEEK_START,
      assignments: [{ employee_id: EMP_B1, work_date: WED, start_time: '10:00', end_time: '19:00' }],
    }))
    expect(foreignEmployee.status).toBe(400)

    const foreignTemplate = await POST(jsonReq('http://localhost/api/workforce/apply', 'POST', {
      weekStart: WEEK_START,
      assignments: [{ employee_id: EMP_A1, work_date: WED, start_time: '10:00', end_time: '19:00', shift_template_id: TPL_B }],
    }))
    expect(foreignTemplate.status).toBe(400)
    expect(db.tables.shift_assignments.map((s) => s.id).sort()).toEqual([SHIFT_A, SHIFT_B].sort())
  })

  it('planning yalnızca aktif mağazanın çalışanlarını ve açık vardiyalarını döner', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { GET } = await import('@/app/api/workforce/planning/route')
    const res = await GET(jsonReq(`http://localhost/api/workforce/planning?week=${WEEK_START}`, 'GET'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { summaries: { employeeId: string }[]; openShiftsThisWeek: { id: string }[] }
    const ids = body.summaries.map((s) => s.employeeId)
    expect(ids).toContain(EMP_A1)
    expect(ids).toContain(EMP_A2)
    expect(ids).not.toContain(EMP_B1)
    expect(ids).not.toContain(MGR_B)
    expect(body.openShiftsThisWeek.map((o) => o.id)).toEqual([OPEN_A])
  })

  it('generate yalnızca aktif mağazanın çalışanlarını planlar', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/workforce/generate/route')
    const res = await POST(jsonReq('http://localhost/api/workforce/generate', 'POST', { week: WEEK_START, seed: 1 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { assignments: { employee_id: string }[] }
    const planned = new Set(body.assignments.map((a) => a.employee_id))
    expect(planned.size).toBeGreaterThan(0)
    expect(planned.has(EMP_B1)).toBe(false)
    expect(planned.has(MGR_B)).toBe(false)
    for (const id of planned) expect([EMP_A1, EMP_A2, MGR_A]).toContain(id)
  })
})

// ─── Açık vardiyalar ─────────────────────────────────────────
describe('/api/open-shifts — mağaza izolasyonu', () => {
  it('GET yalnızca aktif mağazanın açık vardiyalarını döner', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { GET } = await import('@/app/api/open-shifts/route')
    const res = await GET(jsonReq('http://localhost/api/open-shifts', 'GET'))
    const body = (await res.json()) as { open_shifts: { id: string }[] }
    expect(body.open_shifts.map((o) => o.id)).toEqual([OPEN_A])
  })

  it('POST store_id ile oluşturur; bildirimi yalnızca aktif mağazanın çalışanlarına gönderir', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/open-shifts/route')
    const res = await POST(jsonReq('http://localhost/api/open-shifts', 'POST', {
      work_date: WED, start_time: '10:00', end_time: '19:00',
    }))
    expect(res.status).toBe(201)
    const created = db.tables.open_shifts.find((o) => o.work_date === WED)
    expect(created).toMatchObject({ store_id: STORE_A, status: 'open' })
    const targets = db.tables.notifications.map((n) => n.employee_id)
    expect(targets.sort()).toEqual([EMP_A1, EMP_A2].sort())
    expect(targets).not.toContain(EMP_B1)
  })

  it('PATCH başka mağazanın açık vardiyasını değiştirmez (404)', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session(), db)
    const { PATCH } = await import('@/app/api/open-shifts/route')
    const res = await PATCH(jsonReq('http://localhost/api/open-shifts', 'PATCH', { id: OPEN_B, status: 'cancelled' }))
    expect(res.status).toBe(404)
    expect(db.tables.open_shifts.find((o) => o.id === OPEN_B)).toMatchObject({ status: 'open' })

    const own = await PATCH(jsonReq('http://localhost/api/open-shifts', 'PATCH', { id: OPEN_A, status: 'cancelled' }))
    expect(own.status).toBe(200)
    expect(db.tables.open_shifts.find((o) => o.id === OPEN_A)).toMatchObject({ status: 'cancelled' })
  })

  it('claim başka mağazanın açık vardiyasını üstlendirmez (404)', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session({ id: EMP_A2, access_level: ACCESS.EMPLOYEE }), db)
    const { POST } = await import('@/app/api/open-shifts/claim/route')
    const res = await POST(jsonReq('http://localhost/api/open-shifts/claim', 'POST', { open_shift_id: OPEN_B }))
    expect(res.status).toBe(404)
    expect(db.tables.open_shifts.find((o) => o.id === OPEN_B)).toMatchObject({ status: 'open' })
    expect(db.tables.shift_assignments).toHaveLength(2)
  })

  it('claim kendi mağazasının açık vardiyasında vardiyayı store_id ile oluşturur, yalnızca mağaza yöneticilerini bilgilendirir', async () => {
    const db = createFakeDb(seed(), FAKE_OPTIONS)
    setup(session({ id: EMP_A2, access_level: ACCESS.EMPLOYEE }), db)
    const { POST } = await import('@/app/api/open-shifts/claim/route')
    const res = await POST(jsonReq('http://localhost/api/open-shifts/claim', 'POST', { open_shift_id: OPEN_A }))
    expect(res.status).toBe(200)
    expect(db.tables.open_shifts.find((o) => o.id === OPEN_A)).toMatchObject({ status: 'filled', filled_by: EMP_A2 })
    const created = db.tables.shift_assignments.find((s) => s.employee_id === EMP_A2)
    expect(created).toMatchObject({ store_id: STORE_A, work_date: TUE })
    const notified = db.tables.notifications.map((n) => n.employee_id)
    expect(notified).toContain(MGR_A)
    expect(notified).not.toContain(MGR_B)
  })
})

// ─── İşten ayrılan çalışan planlanmaz ─────────────────────────
describe('/api/workforce — işten ayrılan çalışan', () => {
  const withTermination = (date: string) => {
    const data = seed()
    data.employees = data.employees.map((e) => (e.id === EMP_A1 ? { ...e, termination_date: date } : e))
    return data
  }

  it('apply: son çalışma gününden sonraki güne atama 409; hiçbir şey değişmez', async () => {
    const db = createFakeDb(withTermination(TUE), FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/workforce/apply/route')
    const res = await POST(jsonReq('http://localhost/api/workforce/apply', 'POST', {
      weekStart: WEEK_START,
      acknowledge_violations: true,
      assignments: [{ employee_id: EMP_A1, work_date: WED, start_time: '10:00', end_time: '19:00', shift_template_id: TPL_A }],
    }))
    expect(res.status).toBe(409)
    expect(db.tables.shift_assignments.map((s) => s.id).sort()).toEqual([SHIFT_A, SHIFT_B].sort())
  })

  it('apply: son gün dahil planlanır; sonraki günler için haftalık tatil yazılmaz', async () => {
    const db = createFakeDb(withTermination(TUE), FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/workforce/apply/route')
    const res = await POST(jsonReq('http://localhost/api/workforce/apply', 'POST', {
      weekStart: WEEK_START,
      acknowledge_violations: true,
      assignments: [{ employee_id: EMP_A1, work_date: TUE, start_time: '10:00', end_time: '19:00', shift_template_id: TPL_A }],
    }))
    expect(res.status).toBe(200)
    const rests = db.tables.leave_requests.filter((l) => l.employee_id === EMP_A1 && l.leave_type === 'weekly_rest')
    expect(rests.every((l) => (l.start_date as string) <= TUE)).toBe(true)
  })
})

describe('/api/workforce/generate — işten ayrılan çalışan', () => {
  it('son çalışma gününden sonraki günlere vardiya planlanmaz', async () => {
    const data = seed()
    data.employees = data.employees.map((e) => (e.id === EMP_A1 ? { ...e, termination_date: TUE } : e))
    const db = createFakeDb(data, FAKE_OPTIONS)
    setup(session(), db)
    const { POST } = await import('@/app/api/workforce/generate/route')
    const res = await POST(jsonReq('http://localhost/api/workforce/generate', 'POST', { week: WEEK_START, seed: 1 }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { assignments: { employee_id: string; work_date: string }[] }
    const mine = body.assignments.filter((a) => a.employee_id === EMP_A1)
    expect(mine.every((a) => a.work_date <= TUE)).toBe(true)
  })
})
