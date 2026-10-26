/**
 * kioskAccess.test.ts — Kiosk rolü yetki sınırları ve GET /api/kiosk/qr.
 * getCurrentEmployee mock'lanır; kod üretimi bellek içi fake Supabase ile çalışır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ACCESS, roleAtLeast, canManageRole } from '@/lib/auth'
import { createFakeDb } from './helpers/fakeSupabase'
import { canViewKioskQr, kioskQrTopic } from '@/lib/kioskQrService'

const STORE_A = '00000000-0000-0000-0003-00000000000a'
const STORE_B = '00000000-0000-0000-0003-00000000000b'

const kioskEmployee = {
  id: 'kiosk-001', full_name: 'Giriş Kiosku', email: 'kiosk@example.com',
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

describe('canViewKioskQr — SQL can_view_kiosk_qr_topic ile aynı kural', () => {
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

  it('kanal adı kiosk-qr:<store_id> biçimindedir', () => {
    expect(kioskQrTopic(STORE_A)).toBe(`kiosk-qr:${STORE_A}`)
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
    const body = (await res.json()) as { qr_data: string; store_id: string; topic: string }
    expect(body.qr_data).toMatch(/^SU2.[A-Za-z0-9_-]{32}$/)
    expect(db.tables.qr_tokens).toHaveLength(1)
    expect(db.tables.qr_tokens[0].employee_id).toBeNull()
    // Kod mağazaya bağlı üretilir; istemci mağazanın kanalına abone olur
    expect(db.tables.qr_tokens[0].store_id).toBe(STORE_A)
    expect(body.store_id).toBe(STORE_A)
    expect(body.topic).toBe(`kiosk-qr:${STORE_A}`)
  })

  it('başka mağazanın aktif kodu görünmez; kendi mağazası için ayrı kod oluşturulur', async () => {
    const tokenB = 'b'.repeat(32)
    const { res, db } = await callQrRoute(kioskEmployee, [
      { id: 'kq-b', token: tokenB, store_id: STORE_B, employee_id: null, action_type: null, used_at: null, expires_at: '2999-01-01T00:00:00Z' },
    ])
    const body = (await res.json()) as { qr_data: string }
    expect(res.status).toBe(200)
    expect(body.qr_data).not.toBe(`SU2.${tokenB}`)
    expect(db.tables.qr_tokens).toHaveLength(2)
    expect(db.tables.qr_tokens.filter((t) => t.store_id === STORE_A)).toHaveLength(1)
  })

  it('admin aktif mağazasının kodunu ve kanalını alır', async () => {
    const { res, db } = await callQrRoute(adminInB)
    const body = (await res.json()) as { store_id: string; topic: string }
    expect(res.status).toBe(200)
    expect(body.store_id).toBe(STORE_B)
    expect(body.topic).toBe(`kiosk-qr:${STORE_B}`)
    expect(db.tables.qr_tokens[0].store_id).toBe(STORE_B)
  })

  it('aktif kod varsa yenisi oluşturulmaz (istek kodu değiştirmez)', async () => {
    const token = 'a'.repeat(32)
    const { res, db } = await callQrRoute(manager, [
      { id: 'kq-1', token, store_id: STORE_A, employee_id: null, action_type: null, used_at: null, expires_at: '2999-01-01T00:00:00Z' },
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
