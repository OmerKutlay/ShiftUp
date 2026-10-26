// @vitest-environment node
/**
 * employeeOffboardingApi.test.ts — işten ayrılış: yetki, tarih doğrulaması, vardiya / talep temizliği,
 * izin bakiyesi anlık görüntüsü, anında pasifleşme ve geri alma; geçmişi olan çalışanın silinememesi.
 * getCurrentEmployee mock'lanır, veri bellek içi fake Supabase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const STORE_A = '00000000-0000-0000-0003-000000000001'
const STORE_B = '00000000-0000-0000-0003-000000000002'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const E_MGR = id(1)      // oturum: mağaza müdürü
const E_ADMIN = id(2)
const E_STAFF = id(10)   // çıkarılacak çalışan
const E_OTHER = id(11)   // takas karşı tarafı
const E_PEER_MGR = id(12) // başka bir mağaza müdürü (eşit seviye)
const E_ASSISTANT = id(13) // yönetici (manager)
const E_B = id(20)       // B mağazasının çalışanı

const base = { email: null, role_id: null, role_name: null, active: true, home_store_id: STORE_A, store_id: STORE_A }
const asManager = { ...base, id: E_MGR, full_name: 'Müdür', access_level: ACCESS.STORE_MANAGER }
const asAdmin = { ...base, id: E_ADMIN, full_name: 'Admin', access_level: ACCESS.ADMIN }
const asEmployee = { ...base, id: E_OTHER, full_name: 'Çalışan', access_level: ACCESS.EMPLOYEE }
const asAssistant = { ...base, id: E_ASSISTANT, full_name: 'Yönetici', access_level: ACCESS.MANAGER }

const emp = (eid: string, name: string, level: string, extra: object = {}) => ({
  id: eid, full_name: name, store_id: STORE_A, active: true, hire_date: '2022-03-01', birth_date: '1990-01-01',
  termination_date: null, termination_reason: null, auth_user_id: null, roles: { access_level: level }, ...extra,
})
const shift = (sid: string, employee_id: string, store_id: string, work_date: string, extra: object = {}) => ({
  id: sid, employee_id, store_id, work_date, start_time: '09:00:00', end_time: '18:00:00', is_on_leave: false,
  stores: { name: store_id === STORE_A ? 'Kadıköy' : 'Beşiktaş' }, ...extra,
})

function tables() {
  return {
    stores: [{ id: STORE_A, name: 'Kadıköy', active: true }, { id: STORE_B, name: 'Beşiktaş', active: true }],
    employees: [
      emp(E_MGR, 'Müdür', 'store_manager'),
      emp(E_ADMIN, 'Admin', 'admin'),
      emp(E_STAFF, 'Ayşe Çalışan', 'employee', { auth_user_id: 'auth-1' }),
      emp(E_OTHER, 'Karşı Taraf', 'employee'),
      emp(E_PEER_MGR, 'Eş Müdür', 'store_manager'),
      emp(E_ASSISTANT, 'Yönetici', 'manager'),
      emp(E_B, 'B Çalışanı', 'employee', { store_id: STORE_B }),
    ],
    shift_assignments: [
      shift('s-past', E_STAFF, STORE_A, '2026-10-20'),
      shift('s-last', E_STAFF, STORE_A, '2026-10-31'),
      shift('s-a', E_STAFF, STORE_A, '2026-11-02'),
      shift('s-b', E_STAFF, STORE_B, '2026-11-03'), // başka mağazada (ör. geçici görev)
      shift('s-leave', E_STAFF, STORE_A, '2026-11-04', { is_on_leave: true }),
      shift('s-other', E_OTHER, STORE_A, '2026-11-02'),
    ],
    leave_requests: [
      { id: 'l-pending', employee_id: E_STAFF, leave_type: 'annual', start_date: '2026-11-20', end_date: '2026-11-22', status: 'pending' },
      { id: 'l-future', employee_id: E_STAFF, leave_type: 'annual', start_date: '2026-11-10', end_date: '2026-11-12', status: 'approved' },
      // 1-6 Haziran: 6 iş günü (Pzt-Cmt) kullanıldı → 14 - 6 = 8 gün kalır
      { id: 'l-used', employee_id: E_STAFF, leave_type: 'annual', start_date: '2026-06-01', end_date: '2026-06-06', status: 'approved' },
      { id: 'l-other', employee_id: E_OTHER, leave_type: 'annual', start_date: '2026-11-20', end_date: '2026-11-22', status: 'pending' },
    ],
    manual_time_correction_requests: [
      { id: 'tc-1', employee_id: E_STAFF, status: 'pending' },
      { id: 'tc-other', employee_id: E_OTHER, status: 'pending' },
    ],
    shift_swap_requests: [
      { id: 'sw-req', requester_id: E_STAFF, target_id: E_OTHER, status: 'pending' },
      { id: 'sw-tgt', requester_id: E_OTHER, target_id: E_STAFF, status: 'pending' },
      { id: 'sw-unrelated', requester_id: E_OTHER, target_id: E_ASSISTANT, status: 'pending' },
    ],
    open_shifts: [] as Array<Record<string, unknown>>,
    push_subscriptions: [{ id: 'p1', employee_id: E_STAFF, endpoint: 'x' }, { id: 'p2', employee_id: E_OTHER, endpoint: 'y' }],
    notifications: [] as Array<Record<string, unknown>>,
    audit_logs: [] as Array<Record<string, unknown>>,
    public_holidays: [] as Array<Record<string, unknown>>,
    attendance_records: [] as Array<Record<string, unknown>>,
  }
}

vi.setConfig({ testTimeout: 60_000 }) // route modülleri her testte taze yüklenir; yavaş makinede ilk yükleme uzun sürebilir

let db: FakeDb

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
type Mod = { GET: Handler; POST: Handler; DELETE: Handler }

async function offboarding(session: unknown): Promise<Mod> {
  vi.resetModules()
  vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(session) }))
  vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
  vi.doMock('@/lib/db', () => ({ db }))
  return (await import('@/app/api/employees/[id]/offboarding/route')) as unknown as Mod
}

async function employeeRoute(session: unknown) {
  vi.resetModules()
  vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(session) }))
  vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
  vi.doMock('@/lib/db', () => ({ db }))
  return await import('@/app/api/employees/[id]/route')
}

const ctx = (eid: string) => ({ params: Promise.resolve({ id: eid }) })
const post = (body: unknown) =>
  new NextRequest('http://localhost/api/employees/x/offboarding', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
const get = (date?: string) =>
  new NextRequest(`http://localhost/api/employees/x/offboarding${date ? `?date=${date}` : ''}`)
const del = () => new NextRequest('http://localhost/api/employees/x/offboarding', { method: 'DELETE' })

const row = (table: string, rid: string) => db.tables[table].find((r) => r.id === rid)!

beforeEach(() => {
  db = createFakeDb(tables())
  // Bugün: 26 Ekim 2026 (Europe/Istanbul)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T09:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const valid = { last_day: '2026-10-31', reason: 'istifa' }

describe('yetki', () => {
  it('çalışan ve yönetici (Müdür altı) işten çıkış yapamaz (403)', async () => {
    for (const s of [asEmployee, asAssistant]) {
      const m = await offboarding(s)
      expect((await m.POST(post(valid), ctx(E_STAFF))).status).toBe(403)
    }
    expect(row('employees', E_STAFF).termination_date).toBeNull()
  })

  it('kimse kendini çıkaramaz (Admin dahil)', async () => {
    for (const s of [asManager, asAdmin]) {
      const m = await offboarding(s)
      expect((await m.POST(post(valid), ctx(s.id))).status).toBe(403)
    }
  })

  it('müdür eşit seviyedeki müdürü çıkaramaz; Admin çıkarabilir', async () => {
    let m = await offboarding(asManager)
    expect((await m.POST(post(valid), ctx(E_PEER_MGR))).status).toBe(403)
    expect(row('employees', E_PEER_MGR).termination_date).toBeNull()

    m = await offboarding(asAdmin)
    expect((await m.POST(post(valid), ctx(E_PEER_MGR))).status).toBe(200)
    expect(row('employees', E_PEER_MGR).termination_date).toBe('2026-10-31')
  })

  it('başka mağazanın çalışanı için 404 (varlığı sızdırılmaz); önizleme de aynı', async () => {
    const m = await offboarding(asManager)
    expect((await m.POST(post(valid), ctx(E_B))).status).toBe(404)
    expect((await m.GET(get('2026-10-31'), ctx(E_B))).status).toBe(404)
    expect(row('employees', E_B).termination_date).toBeNull()
  })

  it('geri alma yalnızca Admin: müdür 403', async () => {
    const m = await offboarding(asManager)
    await m.POST(post(valid), ctx(E_STAFF))
    expect((await m.DELETE(del(), ctx(E_STAFF))).status).toBe(403)
    expect(row('employees', E_STAFF).termination_date).toBe('2026-10-31')
  })
})

describe('doğrulama', () => {
  it('işe girişten önceki, 30 günden eski ve geçersiz tarihler / neden reddedilir', async () => {
    const m = await offboarding(asManager)
    for (const body of [
      { ...valid, last_day: '2022-02-28' },        // işe girişten önce
      { ...valid, last_day: '2026-09-01' },        // > 30 gün geride
      { ...valid, last_day: '2026-13-40' },        // geçersiz
      { ...valid, last_day: '2028-01-01' },        // > 1 yıl ileride
      { ...valid, reason: 'baska' },               // geçersiz neden
      { last_day: '2026-10-31' },                  // neden yok
      { ...valid, note: 'x'.repeat(501) },         // uzun not
    ]) {
      expect((await m.POST(post(body), ctx(E_STAFF))).status).toBe(400)
    }
    expect(row('employees', E_STAFF).termination_date).toBeNull()
  })

  it('ikinci kez çıkış 409', async () => {
    const m = await offboarding(asManager)
    expect((await m.POST(post(valid), ctx(E_STAFF))).status).toBe(200)
    expect((await m.POST(post(valid), ctx(E_STAFF))).status).toBe(409)
  })
})

describe('önizleme', () => {
  it('tüm mağazalardaki sonraki vardiyaları, iptal edilecek talepleri ve izin bakiyesini listeler; yazmaz', async () => {
    const m = await offboarding(asManager)
    const res = await m.GET(get('2026-10-31'), ctx(E_STAFF))
    expect(res.status).toBe(200)
    const { preview } = await res.json()
    expect(preview.future_shifts.map((s: { id: string }) => s.id)).toEqual(['s-a', 's-b', 's-leave'])
    expect(preview.future_shifts.find((s: { id: string }) => s.id === 's-b')).toMatchObject({ store_id: STORE_B, store_name: 'Beşiktaş' })
    expect(preview).toMatchObject({
      pending_leave: 1, future_approved_leave: 1, pending_time_corrections: 1, pending_swaps: 2, deactivates_now: false,
    })
    expect(preview.leave_balance).toMatchObject({ known: true, entitlement_days: 14, used_days: 6, remaining_days: 8 })
    expect(db.tables.shift_assignments).toHaveLength(6)
    expect(row('employees', E_STAFF).termination_date).toBeNull()
  })
})

describe('uygulama', () => {
  it('gelecek tarihli çıkış: hesap o güne dek aktif kalır, vardiyalar (tüm mağazalar) silinir, talepler iptal edilir', async () => {
    const m = await offboarding(asManager)
    const res = await m.POST(post({ ...valid, note: 'Not' }), ctx(E_STAFF))
    expect(res.status).toBe(200)
    const { result } = await res.json()
    expect(result).toMatchObject({
      shifts_deleted: 3, shifts_converted: 0, leave_cancelled: 2, time_corrections_cancelled: 1, swaps_cancelled: 2,
      leave_balance: 8, deactivated_now: false,
    })

    const staff = row('employees', E_STAFF)
    expect(staff).toMatchObject({
      active: true, termination_date: '2026-10-31', termination_reason: 'istifa', termination_note: 'Not',
      terminated_by: E_MGR, termination_leave_balance: 8,
    })
    expect(staff.terminated_at).toBeTruthy()

    // Son güne kadarki vardiyalar kalır, sonrası (A + B mağazası) silinir; başkasınınki dokunulmaz
    expect(db.tables.shift_assignments.map((s) => s.id).sort()).toEqual(['s-last', 's-other', 's-past'])
    expect(db.tables.open_shifts).toHaveLength(0)

    // Talepler
    expect(row('leave_requests', 'l-pending').status).toBe('rejected')
    expect(row('leave_requests', 'l-future').status).toBe('rejected')
    expect(row('leave_requests', 'l-used').status).toBe('approved')
    expect(row('leave_requests', 'l-other').status).toBe('pending')
    expect(row('manual_time_correction_requests', 'tc-1').status).toBe('rejected')
    expect(row('manual_time_correction_requests', 'tc-other').status).toBe('pending')
    expect(row('shift_swap_requests', 'sw-req').status).toBe('cancelled')
    expect(row('shift_swap_requests', 'sw-tgt').status).toBe('cancelled')
    expect(row('shift_swap_requests', 'sw-unrelated').status).toBe('pending')
    // Karşı taraf bilgilendirilir
    expect(db.tables.notifications.filter((n) => n.employee_id === E_OTHER)).toHaveLength(2)

    // Hesap hâlâ aktif: push abonelikleri son güne dek durur
    expect(db.tables.push_subscriptions).toHaveLength(2)

    // Denetim kaydı
    const log = db.tables.audit_logs.find((l) => l.action === 'employee.terminate')
    expect(log).toMatchObject({ actor_id: E_MGR, store_id: STORE_A, entity_id: E_STAFF })
    expect(log?.after).toMatchObject({ termination_leave_balance: 8, shifts_deleted: 3, swaps_cancelled: 2 })
  })

  it('"açık vardiyaya çevir": izinli olmayan vardiyalar kendi mağazasında açık vardiya olur', async () => {
    const m = await offboarding(asManager)
    const res = await m.POST(post({ ...valid, convert_to_open_shifts: true }), ctx(E_STAFF))
    expect((await res.json()).result).toMatchObject({ shifts_deleted: 3, shifts_converted: 2 })
    expect(db.tables.open_shifts.map((o) => [o.store_id, o.work_date, o.start_time, o.status]).sort()).toEqual([
      [STORE_A, '2026-11-02', '09:00', 'open'],
      [STORE_B, '2026-11-03', '09:00', 'open'],
    ])
  })

  it('geçmiş tarihli çıkış: hesap hemen pasifleşir, push abonelikleri silinir', async () => {
    const m = await offboarding(asManager)
    const res = await m.POST(post({ last_day: '2026-10-20', reason: 'isveren_feshi' }), ctx(E_STAFF))
    expect(res.status).toBe(200)
    expect((await res.json()).result.deactivated_now).toBe(true)
    expect(row('employees', E_STAFF).active).toBe(false)
    expect(db.tables.push_subscriptions.map((p) => p.id)).toEqual(['p2'])
    // 20 Ekim sonrası vardiyalar silinir (31 Ekim dahil)
    expect(db.tables.shift_assignments.map((s) => s.id).sort()).toEqual(['s-other', 's-past'])
  })

  it('bugün son gün: hesap bugün hâlâ aktiftir', async () => {
    const m = await offboarding(asManager)
    await m.POST(post({ last_day: '2026-10-26', reason: 'istifa' }), ctx(E_STAFF))
    expect(row('employees', E_STAFF).active).toBe(true)
  })

  it('yıllık izin bakiyesi bilinmiyorsa (işe giriş yok) snapshot null', async () => {
    row('employees', E_STAFF).hire_date = null
    const m = await offboarding(asManager)
    await m.POST(post(valid), ctx(E_STAFF))
    expect(row('employees', E_STAFF).termination_leave_balance).toBeNull()
  })
})

describe('geri alma (Admin)', () => {
  it('ayrılışı temizler ve aktifliği geri verir; silinen vardiyalar geri gelmez', async () => {
    let m = await offboarding(asManager)
    await m.POST(post({ last_day: '2026-10-20', reason: 'istifa' }), ctx(E_STAFF))
    expect(row('employees', E_STAFF).active).toBe(false)

    m = await offboarding(asAdmin)
    const res = await m.DELETE(del(), ctx(E_STAFF))
    expect(res.status).toBe(200)
    expect(row('employees', E_STAFF)).toMatchObject({
      active: true, termination_date: null, termination_reason: null, termination_note: null,
      terminated_by: null, termination_leave_balance: null,
    })
    expect(db.tables.shift_assignments.find((s) => s.id === 's-a')).toBeUndefined()
    expect(db.tables.audit_logs.some((l) => l.action === 'employee.terminate_undo')).toBe(true)

    // Kayıtlı ayrılış yoksa 409
    expect((await m.DELETE(del(), ctx(E_STAFF))).status).toBe(409)
  })
})

describe('kalıcı silme ve elle aktifleştirme', () => {
  it('kaydı olan çalışan silinemez (409 HAS_RECORDS); kaydı olmayan silinir', async () => {
    const m = await employeeRoute(asManager)
    const del1 = new NextRequest('http://localhost/api/employees/x', { method: 'DELETE' })
    const res = await m.DELETE(del1, ctx(E_STAFF))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('HAS_RECORDS')
    expect(row('employees', E_STAFF)).toBeTruthy()

    db.tables.employees.push(emp(id(30), 'Yanlış Eklenen', 'employee'))
    const ok = await m.DELETE(new NextRequest('http://localhost/api/employees/x', { method: 'DELETE' }), ctx(id(30)))
    expect(ok.status).toBe(200)
    expect(db.tables.employees.find((e) => e.id === id(30))).toBeUndefined()
  })

  it('ayrılışı kayıtlı çalışan PATCH ile aktifleştirilemez (409)', async () => {
    const off = await offboarding(asManager)
    await off.POST(post({ last_day: '2026-10-20', reason: 'istifa' }), ctx(E_STAFF))

    const m = await employeeRoute(asManager)
    const res = await m.PATCH(
      new NextRequest('http://localhost/api/employees/x', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: true }),
      }),
      ctx(E_STAFF)
    )
    expect(res.status).toBe(409)
    expect(row('employees', E_STAFF).active).toBe(false)
  })
})
