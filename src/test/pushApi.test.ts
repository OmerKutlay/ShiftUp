/**
 * pushApi.test.ts — /api/push/config ve /api/push/subscription.
 * Oturum (getCurrentEmployee) mock'lanır; requireAuth gerçek haliyle çalışır (kiosk reddi dahil).
 * Veri bellek içi fake Supabase'e yazılır.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ROLES } from '@/lib/auth/roles'
import { createFakeDb, type FakeDb } from './helpers/fakeSupabase'
import { isValidPushEndpoint, parsePushSubscription } from '@/lib/pushSubscriptionRepository'

const state = vi.hoisted(() => ({ employee: null as unknown, db: null as unknown }))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/supabaseAdmin', () => ({ createAdminClient: vi.fn(() => state.db) }))

import { GET as getConfig } from '@/app/api/push/config/route'
import { POST, DELETE } from '@/app/api/push/subscription/route'

// ── Sabitler ─────────────────────────────────────────────────
const base = { email: null, role: 'Kasiyer', role_id: null, active: true }
const ahmet = { ...base, id: 'emp-ahmet', full_name: 'Ahmet', role_name: ROLES.CALISAN }
const mehmet = { ...base, id: 'emp-mehmet', full_name: 'Mehmet', role_name: ROLES.CALISAN }
const kiosk = { ...base, id: 'kiosk-1', full_name: 'Kiosk', role: 'Kiosk', role_name: ROLES.KIOSK }

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-token-123'
const P256DH = 'B' + 'A'.repeat(86) // 65 bayt → 87 karakter base64url
const AUTH = 'abcdefghijklmnopqrstuv' // 16 bayt → 22 karakter

function subBody(overrides: Record<string, unknown> = {}) {
  return { endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH }, ...overrides }
}

function req(method: string, body?: unknown, path = '/api/push/subscription') {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Vitest/1.0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

let db: FakeDb
beforeEach(() => {
  db = createFakeDb({ push_subscriptions: [] })
  state.db = db
  state.employee = ahmet
})

// ─── GET /api/push/config ────────────────────────────────────
describe('GET /api/push/config', () => {
  const original = process.env.VAPID_PUBLIC_KEY
  afterEach(() => {
    if (original === undefined) delete process.env.VAPID_PUBLIC_KEY
    else process.env.VAPID_PUBLIC_KEY = original
  })

  it('oturum yoksa 401', async () => {
    state.employee = null
    const res = await getConfig(req('GET', undefined, '/api/push/config'))
    expect(res.status).toBe(401)
  })

  it('kiosk hesabı 403', async () => {
    state.employee = kiosk
    const res = await getConfig(req('GET', undefined, '/api/push/config'))
    expect(res.status).toBe(403)
  })

  it('VAPID_PUBLIC_KEY yoksa enabled=false', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    const res = await getConfig(req('GET', undefined, '/api/push/config'))
    expect(await res.json()).toEqual({ enabled: false, publicKey: null })
  })

  it('VAPID_PUBLIC_KEY varsa açık anahtarı döner', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BPubKey_-123'
    const res = await getConfig(req('GET', undefined, '/api/push/config'))
    expect(await res.json()).toEqual({ enabled: true, publicKey: 'BPubKey_-123' })
  })
})

// ─── POST /api/push/subscription ─────────────────────────────
describe('POST /api/push/subscription', () => {
  it('oturum yoksa 401', async () => {
    state.employee = null
    const res = await POST(req('POST', subBody()))
    expect(res.status).toBe(401)
    expect(db.tables.push_subscriptions).toHaveLength(0)
  })

  it('kiosk hesabı abone olamaz (403)', async () => {
    state.employee = kiosk
    const res = await POST(req('POST', subBody()))
    expect(res.status).toBe(403)
    expect(db.tables.push_subscriptions).toHaveLength(0)
  })

  it('geçerli aboneliği oturumdaki çalışana kaydeder', async () => {
    const res = await POST(req('POST', subBody({ employee_id: 'emp-mehmet' })))
    expect(res.status).toBe(200)
    expect(db.tables.push_subscriptions).toHaveLength(1)
    const row = db.tables.push_subscriptions[0]
    // employee_id gövdeden değil oturumdan
    expect(row.employee_id).toBe('emp-ahmet')
    expect(row).toMatchObject({ endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH, user_agent: 'Vitest/1.0' })
  })

  it('aynı endpoint başka hesapla kaydedilince sahibi değişir (cihaz el değiştirdi)', async () => {
    db.tables.push_subscriptions.push({
      id: 'sub-1', employee_id: 'emp-ahmet', endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH, failure_count: 7,
    })
    state.employee = mehmet
    const res = await POST(req('POST', subBody()))
    expect(res.status).toBe(200)
    expect(db.tables.push_subscriptions).toHaveLength(1)
    expect(db.tables.push_subscriptions[0]).toMatchObject({ id: 'sub-1', employee_id: 'emp-mehmet', failure_count: 0 })
  })

  it('JSON olmayan gövde 400', async () => {
    const r = new NextRequest('http://localhost/api/push/subscription', { method: 'POST', body: 'x' })
    const res = await POST(r)
    expect(res.status).toBe(400)
  })

  it.each([
    ['http endpoint', subBody({ endpoint: 'http://fcm.googleapis.com/fcm/send/x' })],
    ['bilinmeyen push servisi', subBody({ endpoint: 'https://evil.example.com/hook' })],
    ['iç ağ adresi', subBody({ endpoint: 'https://169.254.169.254/latest' })],
    ['çok uzun endpoint', subBody({ endpoint: `https://fcm.googleapis.com/${'a'.repeat(2100)}` })],
    ['keys yok', { endpoint: ENDPOINT }],
    ['p256dh base64url değil', subBody({ keys: { p256dh: `${'+'.repeat(87)}`, auth: AUTH } })],
    ['auth çok kısa', subBody({ keys: { p256dh: P256DH, auth: 'abc' } })],
  ])('doğrulama hatası: %s → 400', async (_label, body) => {
    const res = await POST(req('POST', body))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('VALIDATION_ERROR')
    expect(db.tables.push_subscriptions).toHaveLength(0)
  })

  it('rate limit aşılınca 429', async () => {
    state.employee = { ...ahmet, id: 'emp-ratelimit' }
    let last = 200
    for (let i = 0; i < 21; i++) last = (await POST(req('POST', subBody()))).status
    expect(last).toBe(429)
  })

  it('DB hatası 500 ve iç detay sızdırılmaz', async () => {
    db.options.failOn = { 'push_subscriptions:upsert': { message: 'relation does not exist' } }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req('POST', subBody()))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('relation')
    spy.mockRestore()
  })
})

// ─── DELETE /api/push/subscription ───────────────────────────
describe('DELETE /api/push/subscription', () => {
  beforeEach(() => {
    db.tables.push_subscriptions.push({ id: 'sub-1', employee_id: 'emp-ahmet', endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH })
  })

  it('oturum yoksa 401', async () => {
    state.employee = null
    const res = await DELETE(req('DELETE', { endpoint: ENDPOINT }))
    expect(res.status).toBe(401)
    expect(db.tables.push_subscriptions).toHaveLength(1)
  })

  it('kendi aboneliğini siler', async () => {
    const res = await DELETE(req('DELETE', { endpoint: ENDPOINT }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, removed: 1 })
    expect(db.tables.push_subscriptions).toHaveLength(0)
  })

  it('başkasının aboneliğini silemez', async () => {
    state.employee = mehmet
    const res = await DELETE(req('DELETE', { endpoint: ENDPOINT }))
    expect(res.status).toBe(200)
    expect((await res.json()).removed).toBe(0)
    expect(db.tables.push_subscriptions).toHaveLength(1)
  })

  it('geçersiz endpoint 400', async () => {
    const res = await DELETE(req('DELETE', { endpoint: 'javascript:alert(1)' }))
    expect(res.status).toBe(400)
  })
})

// ─── Doğrulayıcılar ──────────────────────────────────────────
describe('push aboneliği doğrulama', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://db5p.notify.windows.com/w/?token=abc',
  ])('bilinen push servisi kabul edilir: %s', (url) => {
    expect(isValidPushEndpoint(url)).toBe(true)
  })

  it.each([
    'https://fcm.googleapis.com.evil.com/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'ftp://fcm.googleapis.com/x',
    '',
    42,
  ])('reddedilir: %s', (url) => {
    expect(isValidPushEndpoint(url)).toBe(false)
  })

  it('anyHost yalnızca biçimi kontrol eder', () => {
    expect(isValidPushEndpoint('https://example.com/x', { anyHost: true })).toBe(true)
    expect(isValidPushEndpoint('http://example.com/x', { anyHost: true })).toBe(false)
  })

  it('parsePushSubscription PushSubscriptionJSON biçimini çözer', () => {
    expect(parsePushSubscription(subBody())).toEqual({ ok: true, value: { endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH } })
    expect(parsePushSubscription(null).ok).toBe(false)
  })
})
