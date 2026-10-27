/**
 * kioskAccess.test.ts — Kiosk rolü yetki sınırları ve GET /api/kiosk/qr.
 * getCurrentEmployee mock'lanır; anahtar üretimi veritabanına gitmez.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS, roleAtLeast, canManageRole } from '@/lib/auth'
import { createFakeDb } from './helpers/fakeSupabase'
import { canViewKioskQr } from '@/lib/kioskQrService'
import type { KioskSeed } from '@/lib/kioskQrCode'

const STORE_A = '00000000-0000-0000-0003-00000000000a'
const STORE_B = '00000000-0000-0000-0003-00000000000b'

const kioskEmployee = {
  id: '00000000-0000-0000-0003-0000000000c1', full_name: 'Giriş Kiosku', email: 'kiosk@example.com',
  role_id: '00000000-0000-0000-0000-000000000005', access_level: ACCESS.KIOSK, active: true,
  home_store_id: STORE_A, store_id: STORE_A,
}
const worker = { ...kioskEmployee, id: 'emp-001', full_name: 'Ahmet', access_level: ACCESS.EMPLOYEE }
const manager = { ...kioskEmployee, id: 'mgr-001', full_name: 'Ayşe', access_level: ACCESS.MANAGER }
// Admin ana mağazası A; aktif mağaza olarak B'yi seçmiş
const adminInB = { ...kioskEmployee, id: 'adm-001', full_name: 'Admin', access_level: ACCESS.ADMIN, home_store_id: STORE_A, store_id: STORE_B }

function mockSession(employee: unknown) {
  vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(employee) }))
}

const req = () => new NextRequest('http://localhost/api/kiosk/qr')

describe('Kiosk rolü — hiyerarşi', () => {
  it('Kiosk hiçbir yönetici/çalışan seviyesini karşılamaz', () => {
    expect(roleAtLeast(ACCESS.KIOSK, ACCESS.EMPLOYEE)).toBe(false)
    expect(roleAtLeast(ACCESS.KIOSK, ACCESS.MANAGER)).toBe(false)
  })

  it('Müdür Yardımcısı kiosk hesabını yönetebilir, kiosk kimseyi yönetemez', () => {
    expect(canManageRole(ACCESS.MANAGER, ACCESS.KIOSK)).toBe(true)
    expect(canManageRole(ACCESS.KIOSK, ACCESS.EMPLOYEE)).toBe(false)
  })
})

describe('requireAuth — kiosk hesabı', () => {
  beforeEach(() => vi.resetModules())

  it('varsayılan olarak 403 (çalışan/yönetici API\'leri kapalı)', async () => {
    mockSession(kioskEmployee)
    const { requireAuth } = await import('@/lib/auth/authorization')
    const result = await requireAuth(req())
    expect('response' in result && result.response.status).toBe(403)
  })

  it('allowKiosk ile geçer', async () => {
    mockSession(kioskEmployee)
    const { requireAuth } = await import('@/lib/auth/authorization')
    const result = await requireAuth(req(), { allowKiosk: true })
    expect('employee' in result).toBe(true)
  })

  it('requireMinRole kiosk\'u reddeder', async () => {
    mockSession(kioskEmployee)
    const { requireMinRole } = await import('@/lib/auth/authorization')
    const result = await requireMinRole(req(), ACCESS.EMPLOYEE)
    expect('response' in result && result.response.status).toBe(403)
  })
})

describe('canViewKioskQr — kiosk anahtarı alma kuralı', () => {
  it('kiosk / yönetici / müdür yalnızca kendi mağazasını görür', () => {
    for (const level of [ACCESS.KIOSK, ACCESS.MANAGER, ACCESS.STORE_MANAGER]) {
      expect(canViewKioskQr(level, STORE_A, STORE_A)).toBe(true)
      expect(canViewKioskQr(level, STORE_A, STORE_B)).toBe(false)
    }
  })

  it('admin her mağazanın kodunu görür', () => {
    expect(canViewKioskQr(ACCESS.ADMIN, STORE_A, STORE_B)).toBe(true)
  })

  it('çalışan ve oturumsuz görmez', () => {
    expect(canViewKioskQr(ACCESS.EMPLOYEE, STORE_A, STORE_A)).toBe(false)
    expect(canViewKioskQr(null, STORE_A, STORE_A)).toBe(false)
    expect(canViewKioskQr(ACCESS.KIOSK, STORE_A, null)).toBe(false)
  })
})

describe('GET /api/kiosk/qr', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.KIOSK_QR_SECRET = 'test-kiosk-secret'
  })

  async function callQrRoute(employee: unknown) {
    mockSession(employee)
    const db = createFakeDb({ qr_tokens: [] })
    vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
    vi.doMock('@/lib/rateLimiter', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: 0 }) }))
    const { GET } = await import('@/app/api/kiosk/qr/route')
    const res = await GET(req())
    return { res, db }
  }

  it('kiosk hesabı mağazasının anahtarını alır; veritabanına kod yazılmaz', async () => {
    const before = Date.now()
    const { res, db } = await callQrRoute(kioskEmployee)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = (await res.json()) as { seed: KioskSeed; store_id: string; server_time: number; step_ms: number }
    expect(body.store_id).toBe(STORE_A)
    expect(body.seed).toMatchObject({ store_id: STORE_A, issuer_id: kioskEmployee.id })
    expect(body.seed.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.seed.expires_at * 1000).toBeGreaterThan(before + 11 * 60 * 60 * 1000)
    expect(body.server_time).toBeGreaterThanOrEqual(before)
    expect(body.step_ms).toBe(60_000)
    expect(db.tables.qr_tokens).toHaveLength(0)
  })

  it('anahtarla ekranda üretilen kod sunucuda doğrulanır', async () => {
    const { res } = await callQrRoute(kioskEmployee)
    const { seed } = (await res.json()) as { seed: KioskSeed }
    const { computeKioskQr } = await import('@/lib/kioskQrCode')
    const { verifyKioskQr } = await import('@/lib/kioskQrService')
    const qr = await computeKioskQr(seed, Date.now())
    await expect(verifyKioskQr(qr, { storeId: STORE_A, scannerId: 'emp-001' })).resolves.toEqual({ issuerId: kioskEmployee.id })
  })

  it('admin aktif mağazasının anahtarını alır', async () => {
    const { res } = await callQrRoute(adminInB)
    const body = (await res.json()) as { store_id: string; seed: KioskSeed }
    expect(res.status).toBe(200)
    expect(body.store_id).toBe(STORE_B)
    expect(body.seed.store_id).toBe(STORE_B)
  })

  it('yönetici kendi mağazasının anahtarını alır', async () => {
    const { res } = await callQrRoute(manager)
    expect(res.status).toBe(200)
  })

  it('çalışan kiosk kodunu göremez → 403', async () => {
    const { res } = await callQrRoute(worker)
    expect(res.status).toBe(403)
  })

  it('oturum yok → 401', async () => {
    const { res } = await callQrRoute(null)
    expect(res.status).toBe(401)
  })
})
