/**
 * kvkk.test.ts — aydınlatma onayı (/api/kvkk/ack), onay listesi, şirket ayarları yetkisi.
 * Oturum mock'lanır; requireAuth/requireMinRole gerçek haliyle çalışır; veri bellek içi fake Supabase'de.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'
import { createFakeDb } from './helpers/fakeSupabase'
import { KVKK_NOTICE_VERSION } from '@/lib/kvkk'

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown }))
vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: vi.fn(() => state.db) }))
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 1, resetAt: 0 })),
}))

import { GET as getAck, POST as postAck } from '@/app/api/kvkk/ack/route'
import { GET as getList } from '@/app/api/kvkk/acknowledgements/route'
import { GET as getCompany, PUT as putCompany } from '@/app/api/company-settings/route'
import { checkRateLimit } from '@/lib/rateLimiter'

const STORE_A = '00000000-0000-0000-0003-000000000001'
const STORE_B = '00000000-0000-0000-0003-000000000002'
const base = { email: null, role_id: null, active: true, home_store_id: STORE_A, store_id: STORE_A }
const worker = { ...base, id: 'emp-1', full_name: 'Ayşe', access_level: ACCESS.EMPLOYEE }
const storeMgr = { ...base, id: 'mgr-1', full_name: 'Müdür', access_level: ACCESS.STORE_MANAGER }
const admin = { ...base, id: 'adm-1', full_name: 'Admin', access_level: ACCESS.ADMIN }
const kiosk = { ...base, id: 'kiosk-1', full_name: 'Kiosk', access_level: ACCESS.KIOSK }

function mkDb() {
  return createFakeDb({
    employees: [
      { id: 'emp-1', full_name: 'Ayşe', store_id: STORE_A, active: true, kvkk_notice_ack_at: null, kvkk_notice_version: null },
      { id: 'emp-2', full_name: 'Bora', store_id: STORE_A, active: true, kvkk_notice_ack_at: '2026-10-28T09:00:00Z', kvkk_notice_version: KVKK_NOTICE_VERSION },
      { id: 'emp-3', full_name: 'Pasif', store_id: STORE_A, active: false, kvkk_notice_ack_at: null, kvkk_notice_version: null },
      { id: 'emp-4', full_name: 'Başka Mağaza', store_id: STORE_B, active: true, kvkk_notice_ack_at: null, kvkk_notice_version: null },
    ],
    company_settings: [{ id: true, legal_name: null, address: null, kvkk_email: null }],
    audit_logs: [],
  })
}
type Db = ReturnType<typeof mkDb>
const table = (name: string) => (state.db as Db).tables[name]

const json = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  state.db = mkDb()
  state.employee = worker
  vi.mocked(checkRateLimit).mockClear()
})

describe('POST /api/kvkk/ack', () => {
  it('oturumsuz 401, kiosk hesabı 403', async () => {
    state.employee = null
    expect((await postAck(json('POST', '/api/kvkk/ack', { version: KVKK_NOTICE_VERSION }))).status).toBe(401)
    state.employee = kiosk
    expect((await postAck(json('POST', '/api/kvkk/ack', { version: KVKK_NOTICE_VERSION }))).status).toBe(403)
  })

  it('güncel sürümü kaydeder, yalnızca kendi satırını günceller ve denetim kaydı yazar', async () => {
    const res = await postAck(json('POST', '/api/kvkk/ack', { version: KVKK_NOTICE_VERSION }))
    expect(res.status).toBe(200)
    expect((await res.json()).acknowledged).toBe(true)
    const rows = table('employees')
    expect(rows.find((r) => r.id === 'emp-1')).toMatchObject({ kvkk_notice_version: KVKK_NOTICE_VERSION })
    expect(rows.find((r) => r.id === 'emp-1')?.kvkk_notice_ack_at).toBeTruthy()
    expect(rows.find((r) => r.id === 'emp-4')?.kvkk_notice_ack_at).toBeNull()
    expect(table('audit_logs')).toHaveLength(1)
    expect(table('audit_logs')[0]).toMatchObject({ action: 'kvkk.notice_ack', actor_id: 'emp-1', store_id: STORE_A })
  })

  it('eski / geçersiz sürümü reddeder, hiçbir şey yazmaz', async () => {
    const res = await postAck(json('POST', '/api/kvkk/ack', { version: '2020-01-01' }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('NOTICE_VERSION_MISMATCH')
    expect(table('audit_logs')).toHaveLength(0)
    expect((await postAck(json('POST', '/api/kvkk/ack', {}))).status).toBe(400)
  })

  it('kullanıcı başına hız sınırı uygulanır', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const res = await postAck(json('POST', '/api/kvkk/ack', { version: KVKK_NOTICE_VERSION }))
    expect(res.status).toBe(429)
    expect(vi.mocked(checkRateLimit).mock.calls[0][0]).toBe('kvkk_ack:emp-1')
  })

  it('GET: onaylamamış çalışan için acknowledged=false, onaylayan için true', async () => {
    expect((await (await getAck(json('GET', '/api/kvkk/ack'))).json()).acknowledged).toBe(false)
    state.employee = { ...worker, id: 'emp-2' }
    expect((await (await getAck(json('GET', '/api/kvkk/ack'))).json()).acknowledged).toBe(true)
  })
})

describe('GET /api/kvkk/acknowledgements', () => {
  it('çalışan 403', async () => {
    expect((await getList(json('GET', '/api/kvkk/acknowledgements'))).status).toBe(403)
  })

  it('mağaza müdürü yalnızca kendi mağazasının aktif çalışanlarını görür (mağaza yalıtımı)', async () => {
    state.employee = storeMgr
    const body = await (await getList(json('GET', '/api/kvkk/acknowledgements'))).json()
    expect(body.employees.map((e: { id: string }) => e.id).sort()).toEqual(['emp-1', 'emp-2'])
    expect(body.employees[0]).not.toHaveProperty('email')
    expect(body.employees[0]).not.toHaveProperty('birth_date')
  })

  it('aktif mağazası B olan admin yalnızca B çalışanlarını görür', async () => {
    state.employee = { ...admin, store_id: STORE_B }
    const body = await (await getList(json('GET', '/api/kvkk/acknowledgements'))).json()
    expect(body.employees.map((e: { id: string }) => e.id)).toEqual(['emp-4'])
  })
})

describe('/api/company-settings yetkisi', () => {
  it('GET: çalışan 403, mağaza müdürü 200', async () => {
    expect((await getCompany(json('GET', '/api/company-settings'))).status).toBe(403)
    state.employee = storeMgr
    expect((await getCompany(json('GET', '/api/company-settings'))).status).toBe(200)
  })

  it('PUT: mağaza müdürü 403 (yalnızca Admin), veri değişmez', async () => {
    state.employee = storeMgr
    const res = await putCompany(json('PUT', '/api/company-settings', { legal_name: 'X A.Ş.' }))
    expect(res.status).toBe(403)
    expect(table('company_settings')[0].legal_name).toBeNull()
  })

  it('PUT: admin kaydeder ve denetim kaydı yazar; geçersiz e-posta reddedilir', async () => {
    state.employee = admin
    const bad = await putCompany(json('PUT', '/api/company-settings', { kvkk_email: 'yanlis' }))
    expect(bad.status).toBe(400)
    const ok = await putCompany(json('PUT', '/api/company-settings', {
      legal_name: ' Örnek Ticaret A.Ş. ', address: 'İstanbul', kvkk_email: 'kvkk@ornek.com',
    }))
    expect(ok.status).toBe(200)
    expect(table('company_settings')[0]).toMatchObject({ legal_name: 'Örnek Ticaret A.Ş.', kvkk_email: 'kvkk@ornek.com' })
    expect(table('audit_logs').at(-1)).toMatchObject({ action: 'company_settings.update', actor_id: 'adm-1' })
  })
})
