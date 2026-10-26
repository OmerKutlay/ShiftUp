/**
 * errorLog.test.ts — logError (kısıtlama, asla fırlatmama), /api/client-errors ve /api/app-errors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS } from '@/lib/auth/roles'

const state = vi.hoisted(() => ({
  employee: null as unknown,
  inserts: [] as Record<string, unknown>[],
  insertError: false,
  listed: [] as unknown[],
  limitAllowed: true,
}))

vi.mock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn(async () => state.employee) }))
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: state.limitAllowed, remaining: 0, resetAt: 0 })),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'cf-ray': 'ray-x' }) }))
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({ ctx: { waitUntil: (p: Promise<unknown>) => void p } }),
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        if (state.insertError) throw new Error('db down')
        state.inserts.push(row)
        return { error: null }
      },
      select: () => ({ order: () => ({ limit: async () => ({ data: state.listed, error: null }) }) }),
    }),
  }),
}))

import { logError, _resetErrorLogThrottle } from '@/lib/errorLog'
import { POST } from '@/app/api/client-errors/route'
import { GET } from '@/app/api/app-errors/route'

const base = { email: null, role_id: null, active: true, home_store_id: 'store-1', store_id: 'store-1' }
const ahmet = { ...base, id: 'emp-ahmet', full_name: 'Ahmet', access_level: ACCESS.EMPLOYEE }
const admin = { ...base, id: 'emp-admin', full_name: 'Admin', access_level: ACCESS.ADMIN }
const kiosk = { ...base, id: 'kiosk-1', full_name: 'Kiosk', access_level: ACCESS.KIOSK }
const manager = { ...base, id: 'emp-mgr', full_name: 'Müdür', access_level: ACCESS.STORE_MANAGER }

const flush = () => new Promise((r) => setTimeout(r, 50))

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  state.inserts = []
  state.insertError = false
  state.limitAllowed = true
  state.employee = ahmet
  _resetErrorLogThrottle()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('logError', () => {
  it('console.error yazar ve app_errors satırı ekler (kısaltılmış)', async () => {
    const err = new Error('x'.repeat(2000))
    logError('GET /api/x', err, { requestId: 'ray-1', employeeId: 'e1', storeId: 's1' })
    await flush()
    expect(console.error).toHaveBeenCalled()
    expect(state.inserts).toHaveLength(1)
    const row = state.inserts[0]
    expect((row.message as string).length).toBe(500)
    expect((row.stack as string).length).toBeLessThanOrEqual(4000)
    expect(row).toMatchObject({ source: 'GET /api/x', request_id: 'ray-1', employee_id: 'e1', store_id: 's1' })
  })

  it('aynı hatayı tekrar tekrar yazmaz', async () => {
    for (let i = 0; i < 10; i++) logError('src', new Error('aynı'))
    await flush()
    expect(state.inserts).toHaveLength(1)
  })

  it('hata fırtınasında isolate başına toplam sınırı uygular', async () => {
    for (let i = 0; i < 100; i++) logError('src', new Error(`farklı ${i}`))
    await flush()
    expect(state.inserts).toHaveLength(30)
  })

  it('DB hata verse de asla fırlatmaz', async () => {
    state.insertError = true
    expect(() => logError('src', new Error('a'))).not.toThrow()
    await flush()
  })

  it('string / null hata nesnelerini kabul eder', async () => {
    expect(() => { logError('a', 'düz metin'); logError('b', null); logError('c', { message: 'm' }) }).not.toThrow()
    await flush()
    expect(state.inserts.map((r) => r.message)).toEqual(['düz metin', 'null', 'm'])
  })
})

function post(body: unknown) {
  return new NextRequest('http://localhost/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/client-errors', () => {
  it('oturum yoksa 401, kiosk 403', async () => {
    state.employee = null
    expect((await POST(post({ message: 'm' }))).status).toBe(401)
    state.employee = kiosk
    expect((await POST(post({ message: 'm' }))).status).toBe(403)
  })

  it('çalışan ve mağaza oturumdan alınır, istemci id\'leri yok sayılır', async () => {
    const res = await POST(post({ message: 'patladı', source: 'app-error', employee_id: 'baska', store_id: 'baska' }))
    expect(res.status).toBe(204)
    await flush()
    expect(state.inserts[0]).toMatchObject({ employee_id: 'emp-ahmet', store_id: 'store-1', source: 'client:app-error' })
  })

  it('message yoksa 400; rate limit aşılırsa 429', async () => {
    expect((await POST(post({}))).status).toBe(400)
    state.limitAllowed = false
    expect((await POST(post({ message: 'm' }))).status).toBe(429)
  })

  it('çok büyük gövdeyi reddeder', async () => {
    const req = new NextRequest('http://localhost/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' },
      body: JSON.stringify({ message: 'm' }),
    })
    expect((await POST(req)).status).toBe(400)
  })
})

describe('GET /api/app-errors', () => {
  const get = () => new NextRequest('http://localhost/api/app-errors')

  it('yalnızca Admin', async () => {
    state.employee = ahmet
    expect((await GET(get())).status).toBe(403)
    state.employee = manager
    expect((await GET(get())).status).toBe(403)
    state.employee = admin
    state.listed = [{ id: '1' }]
    const res = await GET(get())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ errors: [{ id: '1' }] })
  })
})
