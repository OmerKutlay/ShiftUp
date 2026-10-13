/**
 * kioskAccess.test.ts — Kiosk rolü yetki sınırları ve /api/kiosk/key.
 * getCurrentEmployee mock'lanır; anahtar üretimi bellek içi fake Supabase ile çalışır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ROLES, roleAtLeast, canManageRole } from '@/lib/auth'
import { createFakeDb } from './helpers/fakeSupabase'

const kioskEmployee = {
  id: 'kiosk-001', full_name: 'Giriş Kiosku', email: 'kiosk@example.com',
  role: 'Kiosk', role_id: '00000000-0000-0000-0000-000000000005', role_name: ROLES.KIOSK, active: true,
}
const worker = { ...kioskEmployee, id: 'emp-001', full_name: 'Ahmet', role: 'Kasiyer', role_name: ROLES.CALISAN }
const manager = { ...kioskEmployee, id: 'mgr-001', full_name: 'Ayşe', role: 'Müdür Yrd.', role_name: ROLES.MUDUR_YARDIMCISI }

function mockSession(employee: unknown) {
  vi.doMock('@/lib/auth/session', () => ({ getCurrentEmployee: vi.fn().mockResolvedValue(employee) }))
}

const req = () => new NextRequest('http://localhost/api/kiosk/key', { method: 'POST' })

describe('Kiosk rolü — hiyerarşi', () => {
  it('Kiosk hiçbir yönetici/çalışan seviyesini karşılamaz', () => {
    expect(roleAtLeast(ROLES.KIOSK, ROLES.CALISAN)).toBe(false)
    expect(roleAtLeast(ROLES.KIOSK, ROLES.MUDUR_YARDIMCISI)).toBe(false)
  })

  it('Müdür Yardımcısı kiosk hesabını yönetebilir, kiosk kimseyi yönetemez', () => {
    expect(canManageRole(ROLES.MUDUR_YARDIMCISI, ROLES.KIOSK)).toBe(true)
    expect(canManageRole(ROLES.KIOSK, ROLES.CALISAN)).toBe(false)
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
    const result = await requireMinRole(req(), ROLES.CALISAN)
    expect('response' in result && result.response.status).toBe(403)
  })
})

describe('POST /api/kiosk/key', () => {
  beforeEach(() => vi.resetModules())

  async function callKeyRoute(employee: unknown) {
    mockSession(employee)
    const db = createFakeDb({ kiosk_keys: [] })
    vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
    vi.doMock('@/lib/rateLimiter', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: 0 }) }))
    const { POST } = await import('@/app/api/kiosk/key/route')
    const res = await POST(req())
    return { res, db }
  }

  it('kiosk hesabı 1 saatlik imzalama anahtarı alır', async () => {
    const { res, db } = await callKeyRoute(kioskEmployee)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { key_id: string; secret: string; expires_at: string; step_seconds: number }
    expect(body.step_seconds).toBe(15)
    expect(Buffer.from(body.secret, 'base64url')).toHaveLength(32)
    const ttlMs = new Date(body.expires_at).getTime() - Date.now()
    expect(ttlMs).toBeGreaterThan(55 * 60 * 1000)
    expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000)
    expect(db.tables.kiosk_keys).toHaveLength(1)
    expect(db.tables.kiosk_keys[0].employee_id).toBe('kiosk-001')
  })

  it('yönetici de anahtar alabilir', async () => {
    const { res } = await callKeyRoute(manager)
    expect(res.status).toBe(201)
  })

  it('çalışan anahtar alamaz → 403', async () => {
    const { res, db } = await callKeyRoute(worker)
    expect(res.status).toBe(403)
    expect(db.tables.kiosk_keys).toHaveLength(0)
  })

  it('oturum yok → 401', async () => {
    const { res } = await callKeyRoute(null)
    expect(res.status).toBe(401)
  })
})
