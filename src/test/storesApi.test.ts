/**
 * storesApi.test.ts — çoklu mağaza: aktif mağaza çözümleme ve /api/stores uçları.
 * getCurrentEmployee mock'lanır; veri bellek içi fake Supabase ile çalışır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'

const STORE_A = '00000000-0000-0000-0003-000000000001'
const STORE_B = '00000000-0000-0000-0003-000000000002'
const STORE_PASSIVE = '00000000-0000-0000-0003-000000000003'

const base = {
  id: 'emp-001', full_name: 'Ayşe', email: 'ayse@example.com', role_id: null,
  role_name: null, active: true, home_store_id: STORE_A, store_id: STORE_A,
}
const admin = { ...base, id: 'adm-001', access_level: ACCESS.ADMIN }
const storeManager = { ...base, id: 'mgr-001', access_level: ACCESS.STORE_MANAGER }

function storesTable() {
  return [
    { id: STORE_A, name: 'Merkez', active: true, created_at: '2026-01-01', updated_at: '2026-01-01' },
    { id: STORE_B, name: 'Kadıköy', active: true, created_at: '2026-01-02', updated_at: '2026-01-02' },
    { id: STORE_PASSIVE, name: 'Eski', active: false, created_at: '2026-01-03', updated_at: '2026-01-03' },
  ]
}

function employeesTable() {
  return [
    { id: 'e1', store_id: STORE_A, active: true },
    { id: 'e2', store_id: STORE_A, active: true },
    { id: 'e3', store_id: STORE_B, active: true },
    { id: 'e4', store_id: STORE_B, active: false },
  ]
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

describe('resolveActiveStoreId', () => {
  beforeEach(() => vi.resetModules())

  async function resolve(accessLevel: (typeof ACCESS)[keyof typeof ACCESS], requested: string | undefined) {
    const db = createFakeDb({ stores: storesTable() })
    const { resolveActiveStoreId } = await import('@/lib/storeScope')
    return resolveActiveStoreId(db as never, { homeStoreId: STORE_A, accessLevel, requestedStoreId: requested })
  }

  it('admin çerezdeki aktif mağazaya geçer', async () => {
    expect(await resolve(ACCESS.ADMIN, STORE_B)).toBe(STORE_B)
  })

  it('admin için pasif / bilinmeyen / bozuk mağaza ana mağazaya düşer', async () => {
    expect(await resolve(ACCESS.ADMIN, STORE_PASSIVE)).toBe(STORE_A)
    expect(await resolve(ACCESS.ADMIN, '00000000-0000-0000-0003-000000000099')).toBe(STORE_A)
    expect(await resolve(ACCESS.ADMIN, 'bozuk')).toBe(STORE_A)
    expect(await resolve(ACCESS.ADMIN, undefined)).toBe(STORE_A)
  })

  it('admin olmayanlar çerezle mağaza değiştiremez', async () => {
    expect(await resolve(ACCESS.STORE_MANAGER, STORE_B)).toBe(STORE_A)
    expect(await resolve(ACCESS.MANAGER, STORE_B)).toBe(STORE_A)
    expect(await resolve(ACCESS.EMPLOYEE, STORE_B)).toBe(STORE_A)
    expect(await resolve(ACCESS.KIOSK, STORE_B)).toBe(STORE_A)
  })
})

describe('storeScope yardımcıları', () => {
  beforeEach(() => vi.resetModules())

  it('storeEmployeeIds yalnızca mağazanın çalışanlarını döner', async () => {
    setup(admin, createFakeDb({ employees: employeesTable() }))
    const { storeEmployeeIds } = await import('@/lib/storeScope')
    expect((await storeEmployeeIds(STORE_B)).sort()).toEqual(['e3', 'e4'])
    expect(await storeEmployeeIds(STORE_B, { activeOnly: true })).toEqual(['e3'])
  })

  it('isEmployeeInStore / areEmployeesInStore başka mağazanın çalışanını reddeder', async () => {
    setup(admin, createFakeDb({ employees: employeesTable() }))
    const { isEmployeeInStore, areEmployeesInStore } = await import('@/lib/storeScope')
    // id'ler UUID değil → doğrulanmaz
    expect(await isEmployeeInStore('e1', STORE_A)).toBe(false)
    expect(await areEmployeesInStore([], STORE_A)).toBe(true)
  })

  it('UUID çalışan id\'leriyle mağaza üyeliği doğrulanır', async () => {
    const e1 = '00000000-0000-4000-8000-0000000000e1'
    const e3 = '00000000-0000-4000-8000-0000000000e3'
    setup(admin, createFakeDb({
      employees: [{ id: e1, store_id: STORE_A, active: true }, { id: e3, store_id: STORE_B, active: true }],
    }))
    const { isEmployeeInStore, areEmployeesInStore } = await import('@/lib/storeScope')
    expect(await isEmployeeInStore(e1, STORE_A)).toBe(true)
    expect(await isEmployeeInStore(e3, STORE_A)).toBe(false)
    expect(await areEmployeesInStore([e1, e1], STORE_A)).toBe(true)
    expect(await areEmployeesInStore([e1, e3], STORE_A)).toBe(false)
  })
})

describe('GET /api/stores', () => {
  beforeEach(() => vi.resetModules())

  it('admin tüm mağazaları aktif çalışan sayılarıyla görür', async () => {
    setup(admin, createFakeDb({ stores: storesTable(), employees: employeesTable() }))
    const { GET } = await import('@/app/api/stores/route')
    const res = await GET(new NextRequest('http://localhost/api/stores'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { stores: { id: string; employee_count: number }[]; active_store_id: string }
    expect(body.stores.map((s) => s.id).sort()).toEqual([STORE_A, STORE_B, STORE_PASSIVE].sort())
    expect(body.stores.find((s) => s.id === STORE_A)?.employee_count).toBe(2)
    expect(body.stores.find((s) => s.id === STORE_B)?.employee_count).toBe(1)
    expect(body.active_store_id).toBe(STORE_A)
  })

  it('müdür yalnızca kendi mağazasını görür', async () => {
    setup(storeManager, createFakeDb({ stores: storesTable(), employees: employeesTable() }))
    const { GET } = await import('@/app/api/stores/route')
    const res = await GET(new NextRequest('http://localhost/api/stores'))
    const body = (await res.json()) as { stores: { id: string }[] }
    expect(body.stores.map((s) => s.id)).toEqual([STORE_A])
  })
})

describe('POST /api/stores', () => {
  beforeEach(() => vi.resetModules())

  it('admin mağaza oluşturur ve denetim kaydı mağazayla yazılır', async () => {
    const db = createFakeDb({ stores: storesTable(), audit_logs: [] })
    setup(admin, db)
    const { POST } = await import('@/app/api/stores/route')
    const res = await POST(jsonReq('http://localhost/api/stores', 'POST', { name: '  Beşiktaş   Mağazası ' }))
    expect(res.status).toBe(201)
    const { store } = (await res.json()) as { store: { id: string; name: string } }
    expect(store.name).toBe('Beşiktaş Mağazası')
    expect(db.tables.audit_logs[0]).toMatchObject({ action: 'store.create', store_id: store.id })
  })

  it('müdür mağaza oluşturamaz', async () => {
    setup(storeManager, createFakeDb({ stores: storesTable() }))
    const { POST } = await import('@/app/api/stores/route')
    const res = await POST(jsonReq('http://localhost/api/stores', 'POST', { name: 'Yeni' }))
    expect(res.status).toBe(403)
  })

  it('boş ad reddedilir', async () => {
    setup(admin, createFakeDb({ stores: storesTable() }))
    const { POST } = await import('@/app/api/stores/route')
    const res = await POST(jsonReq('http://localhost/api/stores', 'POST', { name: '   ' }))
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/stores/[id]', () => {
  beforeEach(() => vi.resetModules())

  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  it('aktif çalışanı olan mağaza pasife alınamaz (409)', async () => {
    setup(admin, createFakeDb({ stores: storesTable(), employees: employeesTable(), audit_logs: [] }))
    const { PATCH } = await import('@/app/api/stores/[id]/route')
    const res = await PATCH(jsonReq(`http://localhost/api/stores/${STORE_B}`, 'PATCH', { active: false }), params(STORE_B))
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('STORE_HAS_EMPLOYEES')
  })

  it('admin mağaza adını değiştirir', async () => {
    const db = createFakeDb({ stores: storesTable(), employees: employeesTable(), audit_logs: [] })
    setup(admin, db)
    const { PATCH } = await import('@/app/api/stores/[id]/route')
    const res = await PATCH(jsonReq(`http://localhost/api/stores/${STORE_B}`, 'PATCH', { name: 'Kadıköy 2' }), params(STORE_B))
    expect(res.status).toBe(200)
    expect(db.tables.stores.find((s) => s.id === STORE_B)?.name).toBe('Kadıköy 2')
    expect(db.tables.audit_logs[0]).toMatchObject({ action: 'store.update', store_id: STORE_B })
  })

  it('bilinmeyen mağaza 404', async () => {
    setup(admin, createFakeDb({ stores: storesTable(), employees: [] }))
    const { PATCH } = await import('@/app/api/stores/[id]/route')
    const id = '00000000-0000-0000-0003-000000000099'
    const res = await PATCH(jsonReq(`http://localhost/api/stores/${id}`, 'PATCH', { name: 'X' }), params(id))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/stores/active', () => {
  beforeEach(() => vi.resetModules())

  it('admin aktif mağazayı seçer → httpOnly çerez', async () => {
    setup(admin, createFakeDb({ stores: storesTable() }))
    const { POST } = await import('@/app/api/stores/active/route')
    const res = await POST(jsonReq('http://localhost/api/stores/active', 'POST', { store_id: STORE_B }))
    expect(res.status).toBe(200)
    const cookie = res.cookies.get('shiftup_store')
    expect(cookie?.value).toBe(STORE_B)
    expect(cookie?.httpOnly).toBe(true)
  })

  it('pasif mağaza seçilemez', async () => {
    setup(admin, createFakeDb({ stores: storesTable() }))
    const { POST } = await import('@/app/api/stores/active/route')
    const res = await POST(jsonReq('http://localhost/api/stores/active', 'POST', { store_id: STORE_PASSIVE }))
    expect(res.status).toBe(404)
  })

  it('müdür aktif mağaza değiştiremez', async () => {
    setup(storeManager, createFakeDb({ stores: storesTable() }))
    const { POST } = await import('@/app/api/stores/active/route')
    const res = await POST(jsonReq('http://localhost/api/stores/active', 'POST', { store_id: STORE_B }))
    expect(res.status).toBe(403)
  })
})
