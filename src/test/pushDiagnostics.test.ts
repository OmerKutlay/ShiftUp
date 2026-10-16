/**
 * pushDiagnostics.test.ts — push teşhis adımları (saf fonksiyon) ve
 * /api/push/diagnostics + /api/push/test route'ları.
 * Oturum (getCurrentEmployee) mock'lanır; requireAuth/requireMinRole gerçek haliyle çalışır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ROLES } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'
import {
  computePushDiagnosticSteps,
  functionStep,
  parseSendResult,
  type PushDbDiagnostics,
  type PushDiagnosticsInput,
} from '@/lib/pushDiagnostics'

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown }))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: vi.fn(() => state.db) }))

import { GET as getDiagnostics } from '@/app/api/push/diagnostics/route'
import { POST as postTest } from '@/app/api/push/test/route'

// ── Sabitler ─────────────────────────────────────────────────
const base = { email: null, role: 'Kasiyer', role_id: null, active: true }
const ahmet = { ...base, id: 'emp-ahmet', full_name: 'Ahmet', role_name: ROLES.CALISAN }
const yardimci = { ...base, id: 'emp-yrd', full_name: 'Yardımcı', role_name: ROLES.MUDUR_YARDIMCISI }
const mudur = { ...base, id: 'emp-mudur', full_name: 'Müdür', role_name: ROLES.MAGAZA_MUDURU }
const kiosk = { ...base, id: 'kiosk-1', full_name: 'Kiosk', role: 'Kiosk', role_name: ROLES.KIOSK }

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1'

const healthyDb: PushDbDiagnostics = {
  pg_net: true,
  vault: true,
  function_url: true,
  webhook_secret: true,
  trigger: true,
  subscriptions: 3,
  recent_responses: [
    { status_code: 200, error_msg: null, content: '{"sent":1,"failed":0,"removed":0}', created: '2026-10-16T10:00:00Z' },
  ],
}

function input(overrides: Partial<PushDiagnosticsInput> = {}): PushDiagnosticsInput {
  return { vapidPublicKey: true, mySubscriptions: 1, thisDevice: true, db: healthyDb, ...overrides }
}

function step(steps: ReturnType<typeof computePushDiagnosticSteps>, key: string) {
  const s = steps.find((x) => x.key === key)
  if (!s) throw new Error(`adım yok: ${key}`)
  return s
}

// ─── Saf fonksiyon ───────────────────────────────────────────
describe('computePushDiagnosticSteps', () => {
  it('adımlar zincir sırasıyla döner; her şey yolundaysa hepsi ok ve ipucu yok', () => {
    const steps = computePushDiagnosticSteps(input())
    expect(steps.map((s) => s.key)).toEqual(['vapid', 'migration', 'pg_net', 'vault', 'trigger', 'subscription', 'function'])
    expect(steps.every((s) => s.ok === true && s.hint === null)).toBe(true)
    expect(step(steps, 'function').label).toContain('gönderilen 1')
  })

  it('VAPID_PUBLIC_KEY yoksa Cloudflare ipucu', () => {
    const s = step(computePushDiagnosticSteps(input({ vapidPublicKey: false })), 'vapid')
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('VAPID_PUBLIC_KEY')
    expect(s.hint).toContain('scripts/setup-push.sh')
  })

  it('migration yoksa DB adımları kontrol edilemedi (null), abonelik yine raporlanır', () => {
    const steps = computePushDiagnosticSteps(input({ db: { migrationMissing: true }, mySubscriptions: 0, thisDevice: null }))
    expect(steps).toHaveLength(7)
    expect(step(steps, 'migration')).toMatchObject({ ok: false })
    expect(step(steps, 'migration').hint).toContain('20261017100000')
    for (const k of ['pg_net', 'vault', 'trigger', 'function']) expect(step(steps, k).ok).toBeNull()
    expect(step(steps, 'subscription').ok).toBe(false)
  })

  it('pg_net yok', () => {
    const s = step(computePushDiagnosticSteps(input({ db: { ...healthyDb, pg_net: false } })), 'pg_net')
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('pg_net')
  })

  it('Vault erişilemiyor', () => {
    const s = step(
      computePushDiagnosticSteps(input({ db: { ...healthyDb, vault: false, function_url: false, webhook_secret: false } })),
      'vault',
    )
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('erişilemiyor')
  })

  it.each([
    [{ function_url: false }, 'push_function_url', 'push_webhook_secret'],
    [{ webhook_secret: false }, 'push_webhook_secret', 'push_function_url'],
  ])('eksik Vault secret adı ipucunda: %o', (patch, present, absent) => {
    const s = step(computePushDiagnosticSteps(input({ db: { ...healthyDb, ...patch } })), 'vault')
    expect(s.ok).toBe(false)
    expect(s.hint).toContain(present)
    expect(s.hint).not.toContain(absent)
  })

  it('tetikleyici yok / devre dışı', () => {
    const s = step(computePushDiagnosticSteps(input({ db: { ...healthyDb, trigger: false } })), 'trigger')
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('20261016100000')
  })

  it('kayıtlı cihaz yok', () => {
    const s = step(computePushDiagnosticSteps(input({ mySubscriptions: 0, thisDevice: null })), 'subscription')
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('Anlık bildirimler')
  })

  it('başka cihazlar kayıtlı ama bu cihaz değil', () => {
    const s = step(computePushDiagnosticSteps(input({ mySubscriptions: 2, thisDevice: false })), 'subscription')
    expect(s.ok).toBe(false)
    expect(s.label).toContain('bu cihaz kayıtlı değil')
  })

  it('endpoint gönderilmediyse (thisDevice null) sayı yeterli', () => {
    expect(step(computePushDiagnosticSteps(input({ thisDevice: null })), 'subscription').ok).toBe(true)
  })
})

describe('functionStep (son send-push yanıtı)', () => {
  const r = (status_code: number | null, extra: Record<string, unknown> = {}) => ({
    status_code, error_msg: null, content: null, created: '2026-10-16T10:00:00Z', ...extra,
  })

  it('çağrı yoksa ok=null ve test bildirimi önerisi', () => {
    const s = functionStep(undefined)
    expect(s.ok).toBeNull()
    expect(s.hint).toContain('Test bildirimi')
  })

  it('401 → secret uyuşmazlığı / verify-jwt', () => {
    const s = functionStep(r(401))
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('push_webhook_secret')
    expect(s.hint).toContain('--no-verify-jwt')
    expect(s.hint).toContain('scripts/setup-push.sh')
  })

  it('404 → fonksiyon deploy edilmemiş / URL yanlış', () => {
    const s = functionStep(r(404))
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('deploy')
    expect(s.hint).toContain('push_function_url')
  })

  it.each([500, 503])('%i → fonksiyon secret\'ları ve loglar', (code) => {
    const s = functionStep(r(code))
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('VAPID_PRIVATE_KEY')
    expect(s.hint).toContain('VAPID_SUBJECT')
    expect(s.label).toContain(`HTTP ${code}`)
  })

  it('status yok (zaman aşımı / DNS) → ağ hatası ipucu', () => {
    const s = functionStep(r(null, { error_msg: 'Timeout of 10000 ms reached' }))
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('Timeout')
    expect(s.hint).toContain('push_function_url')
  })

  it('200 ama push servisi hepsini reddetti → VAPID çifti uyuşmazlığı', () => {
    const s = functionStep(r(200, { content: '{"sent":0,"failed":2,"removed":0}' }))
    expect(s.ok).toBe(false)
    expect(s.hint).toContain('VAPID_PUBLIC_KEY')
  })

  it('200 ve gövde çözülemezse yine ok', () => {
    expect(functionStep(r(200, { content: 'ok' })).ok).toBe(true)
  })

  it('diğer 4xx → beklenmeyen yanıt', () => {
    expect(functionStep(r(400)).ok).toBe(false)
  })

  it('parseSendResult', () => {
    expect(parseSendResult('{"sent":2,"failed":1}')).toEqual({ sent: 2, failed: 1 })
    expect(parseSendResult('{"error":"x"}')).toBeNull()
    expect(parseSendResult(null)).toBeNull()
  })
})

// ─── Route'lar ───────────────────────────────────────────────
function req(method: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

let db: FakeDb
let rpcCalls: number
beforeEach(() => {
  rpcCalls = 0
  db = createFakeDb(
    { push_subscriptions: [], notifications: [] },
    {
      rpc: {
        push_diagnostics: () => {
          rpcCalls++
          return { data: healthyDb, error: null }
        },
      },
    },
  )
  state.db = db
  state.employee = mudur
})

describe('GET /api/push/diagnostics', () => {
  const original = process.env.VAPID_PUBLIC_KEY
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = 'BPub'
  })
  afterEach(() => {
    if (original === undefined) delete process.env.VAPID_PUBLIC_KEY
    else process.env.VAPID_PUBLIC_KEY = original
  })

  it('oturum yoksa 401', async () => {
    state.employee = null
    expect((await getDiagnostics(req('GET', '/api/push/diagnostics'))).status).toBe(401)
  })

  it.each([['Çalışan', ahmet], ['Müdür Yardımcısı', yardimci], ['Kiosk', kiosk]])('%s 403', async (_l, emp) => {
    state.employee = emp
    expect((await getDiagnostics(req('GET', '/api/push/diagnostics'))).status).toBe(403)
    expect(rpcCalls).toBe(0)
  })

  it('Mağaza Müdürü 200: uygulama, kendi abonelikleri, DB durumu ve adımlar', async () => {
    db.tables.push_subscriptions.push(
      { id: 's1', employee_id: 'emp-mudur', endpoint: ENDPOINT },
      { id: 's2', employee_id: 'emp-mudur', endpoint: 'https://fcm.googleapis.com/fcm/send/device-2' },
      { id: 's3', employee_id: 'emp-ahmet', endpoint: 'https://fcm.googleapis.com/fcm/send/other' },
    )
    const res = await getDiagnostics(req('GET', `/api/push/diagnostics?endpoint=${encodeURIComponent(ENDPOINT)}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.app).toEqual({ vapidPublicKey: true })
    expect(body.me).toEqual({ subscriptions: 2, thisDevice: true })
    expect(body.db).toMatchObject({ pg_net: true, trigger: true, subscriptions: 3 })
    expect(body.steps.map((s: { key: string }) => s.key)).toEqual(
      ['vapid', 'migration', 'pg_net', 'vault', 'trigger', 'subscription', 'function'],
    )
    expect(body.steps.every((s: { ok: boolean }) => s.ok === true)).toBe(true)
  })

  it('bu cihazın endpoint\'i kayıtlı değilse thisDevice=false', async () => {
    db.tables.push_subscriptions.push({ id: 's1', employee_id: 'emp-mudur', endpoint: ENDPOINT })
    const res = await getDiagnostics(req('GET', '/api/push/diagnostics?endpoint=https%3A%2F%2Fx.example%2Fy'))
    expect((await res.json()).me).toEqual({ subscriptions: 1, thisDevice: false })
  })

  it('Yönetici de erişebilir', async () => {
    state.employee = { ...mudur, id: 'emp-yon', role_name: ROLES.YONETICI }
    expect((await getDiagnostics(req('GET', '/api/push/diagnostics'))).status).toBe(200)
  })

  it.each(['42P01', 'PGRST205'])('push_subscriptions tablosu yok (%s) → migrationMissing', async (code) => {
    db.options.failOn = { 'push_subscriptions:select': { message: 'relation does not exist', code } }
    const res = await getDiagnostics(req('GET', '/api/push/diagnostics'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.db).toEqual({ migrationMissing: true })
    expect(body.steps.find((s: { key: string }) => s.key === 'migration').ok).toBe(false)
    expect(rpcCalls).toBe(0)
  })

  it.each(['PGRST202', '42883'])('push_diagnostics RPC yok (%s) → migrationMissing', async (code) => {
    db.options.rpc = { push_diagnostics: () => ({ data: null, error: { message: 'function not found', code } }) }
    const body = await (await getDiagnostics(req('GET', '/api/push/diagnostics'))).json()
    expect(body.db).toEqual({ migrationMissing: true })
  })

  it('VAPID_PUBLIC_KEY yoksa app.vapidPublicKey=false ve ilk adım başarısız', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    const body = await (await getDiagnostics(req('GET', '/api/push/diagnostics'))).json()
    expect(body.app.vapidPublicKey).toBe(false)
    expect(body.steps[0]).toMatchObject({ key: 'vapid', ok: false })
  })

  it('beklenmeyen DB hatası 500 ve detay sızdırılmaz', async () => {
    db.options.rpc = { push_diagnostics: () => ({ data: null, error: { message: 'permission denied for vault', code: '42501' } }) }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await getDiagnostics(req('GET', '/api/push/diagnostics'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('vault')
    spy.mockRestore()
  })
})

describe('POST /api/push/test', () => {
  it('oturum yoksa 401', async () => {
    state.employee = null
    expect((await postTest(req('POST', '/api/push/test', {}))).status).toBe(401)
    expect(db.tables.notifications).toHaveLength(0)
  })

  it('kiosk hesabı 403', async () => {
    state.employee = kiosk
    expect((await postTest(req('POST', '/api/push/test', {}))).status).toBe(403)
    expect(db.tables.notifications).toHaveLength(0)
  })

  it('oturumdaki çalışana push_test bildirimi ekler (gövdedeki employee_id yok sayılır)', async () => {
    state.employee = ahmet
    const res = await postTest(req('POST', '/api/push/test', { employee_id: 'emp-mudur' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    expect(db.tables.notifications).toHaveLength(1)
    expect(db.tables.notifications[0]).toMatchObject({
      employee_id: 'emp-ahmet',
      type: 'push_test',
      title: 'Test bildirimi',
      message: 'Bu bir deneme bildirimidir. Telefonunuzun bildirim panelinde görüyorsanız kurulum tamam.',
      is_read: false,
    })
  })

  it('enum değeri yoksa (22P02) 409 ve migration adı', async () => {
    db.options.failOn = {
      'notifications:insert': { message: 'invalid input value for enum notification_type: "push_test"', code: '22P02' },
    }
    const res = await postTest(req('POST', '/api/push/test', {}))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('MIGRATION_MISSING')
    expect(body.error).toContain('20261017100000')
  })

  it('diğer DB hatası 500', async () => {
    db.options.failOn = { 'notifications:insert': { message: 'boom' } }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await postTest(req('POST', '/api/push/test', {}))).status).toBe(500)
    spy.mockRestore()
  })

  it('10 dakikada 5\'ten fazla istek 429', async () => {
    state.employee = { ...ahmet, id: 'emp-push-test-rl' }
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await postTest(req('POST', '/api/push/test', {}))).status)
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true)
    expect(statuses[5]).toBe(429)
  })
})
