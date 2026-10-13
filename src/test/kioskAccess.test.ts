/**
 * kioskAccess.test.ts — Kiosk rolü yetki sınırları ve GET /api/kiosk/qr.
 * getCurrentEmployee mock'lanır; kod üretimi bellek içi fake Supabase ile çalışır.
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

const req = () => new NextRequest('http://localhost/api/kiosk/qr')

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

describe('GET /api/kiosk/qr', () => {
  beforeEach(() => vi.resetModules())

  async function callQrRoute(employee: unknown, qrTokens: Record<string, unknown>[] = []) {
    mockSession(employee)
    const db = createFakeDb({ qr_tokens: qrTokens })
    vi.doMock('@/lib/supabaseAdmin', () => ({ createAdminClient: () => db }))
    vi.doMock('@/lib/rateLimiter', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetAt: 0 }) }))
    const { GET } = await import('@/app/api/kiosk/qr/route')
    const res = await GET(req())
    return { res, db }
  }

  it('kiosk hesabı aktif kodu alır; yoksa tek bir kod oluşturulur', async () => {
    const { res, db } = await callQrRoute(kioskEmployee)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { qr_data: string }
    expect(body.qr_data).toMatch(/^SU2.[A-Za-z0-9_-]{32}$/)
    expect(db.tables.qr_tokens).toHaveLength(1)
    expect(db.tables.qr_tokens[0].employee_id).toBeNull()
  })

  it('aktif kod varsa yenisi oluşturulmaz (istek kodu değiştirmez)', async () => {
    const token = 'a'.repeat(32)
    const { res, db } = await callQrRoute(manager, [
      { id: 'kq-1', token, employee_id: null, action_type: null, used_at: null, expires_at: '2999-01-01T00:00:00Z' },
    ])
    expect(res.status).toBe(200)
    expect(((await res.json()) as { qr_data: string }).qr_data).toBe(`SU2.${token}`)
    expect(db.tables.qr_tokens).toHaveLength(1)
  })

  it('çalışan kiosk kodunu göremez → 403', async () => {
    const { res, db } = await callQrRoute(worker)
    expect(res.status).toBe(403)
    expect(db.tables.qr_tokens).toHaveLength(0)
  })

  it('oturum yok → 401', async () => {
    const { res } = await callQrRoute(null)
    expect(res.status).toBe(401)
  })
})
