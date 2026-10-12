/**
 * authorization.test.ts — RBAC helper unit testleri
 *
 * getCurrentEmployee() DB çağrısı gerektirdiğinden mock'lanır.
 * hasRole(), roleAtLeast() saf fonksiyon — doğrudan test edilir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasRole, roleAtLeast, ROLES, MANAGER_ROLES } from '@/lib/auth'

// ─── roleAtLeast ──────────────────────────────────────────────
describe('roleAtLeast', () => {
  it('Yönetici tüm rollerin üzerinde', () => {
    expect(roleAtLeast(ROLES.YONETICI, ROLES.CALISAN)).toBe(true)
    expect(roleAtLeast(ROLES.YONETICI, ROLES.MUDUR_YARDIMCISI)).toBe(true)
    expect(roleAtLeast(ROLES.YONETICI, ROLES.MAGAZA_MUDURU)).toBe(true)
    expect(roleAtLeast(ROLES.YONETICI, ROLES.YONETICI)).toBe(true)
  })

  it('Çalışan yalnızca kendi seviyesinde', () => {
    expect(roleAtLeast(ROLES.CALISAN, ROLES.CALISAN)).toBe(true)
    expect(roleAtLeast(ROLES.CALISAN, ROLES.MUDUR_YARDIMCISI)).toBe(false)
    expect(roleAtLeast(ROLES.CALISAN, ROLES.MAGAZA_MUDURU)).toBe(false)
    expect(roleAtLeast(ROLES.CALISAN, ROLES.YONETICI)).toBe(false)
  })

  it('Müdür Yardımcısı Çalışan seviyesinin üstünde', () => {
    expect(roleAtLeast(ROLES.MUDUR_YARDIMCISI, ROLES.CALISAN)).toBe(true)
    expect(roleAtLeast(ROLES.MUDUR_YARDIMCISI, ROLES.MUDUR_YARDIMCISI)).toBe(true)
    expect(roleAtLeast(ROLES.MUDUR_YARDIMCISI, ROLES.MAGAZA_MUDURU)).toBe(false)
  })

  it('Tanımlanmamış rol false döner', () => {
    expect(roleAtLeast('BilinmeyenRol', ROLES.CALISAN)).toBe(false)
  })
})

// ─── hasRole ─────────────────────────────────────────────────
describe('hasRole', () => {
  it('Employee rolü izin listesinde varsa true', () => {
    expect(hasRole(ROLES.MAGAZA_MUDURU, MANAGER_ROLES)).toBe(true)
    expect(hasRole(ROLES.YONETICI, MANAGER_ROLES)).toBe(true)
    expect(hasRole(ROLES.MUDUR_YARDIMCISI, MANAGER_ROLES)).toBe(true)
  })

  it('Çalışan MANAGER_ROLES listesinde değil', () => {
    expect(hasRole(ROLES.CALISAN, MANAGER_ROLES)).toBe(false)
  })

  it('null/undefined rol false döner', () => {
    expect(hasRole(null, MANAGER_ROLES)).toBe(false)
    expect(hasRole(undefined, MANAGER_ROLES)).toBe(false)
  })

  it('Boş izin listesi her zaman false', () => {
    expect(hasRole(ROLES.YONETICI, [])).toBe(false)
  })
})

// ─── requireAuth / requireRole (mock tabanlı) ─────────────────
describe('requireAuth + requireRole entegrasyon', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('getCurrentEmployee null döndüğünde requireAuth 401 response verir', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue(null),
    }))
    const { requireAuth } = await import('@/lib/auth/authorization')

    const mockReq = {
      cookies: { get: vi.fn().mockReturnValue(undefined) },
    } as never

    const result = await requireAuth(mockReq)
    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(401)
    }
  })

  it('Yetersiz rol ile requireRole 403 döner', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue({
        id: 'emp-001',
        full_name: 'Test',
        email: null,
        role: 'Kasiyer',
        role_id: '00000000-0000-0000-0000-000000000004',
        role_name: ROLES.CALISAN,
        active: true,
      }),
    }))
    const { requireRole } = await import('@/lib/auth/authorization')

    const mockReq = {
      cookies: { get: vi.fn().mockReturnValue({ value: '{"employeeId":"emp-001"}' }) },
    } as never

    const result = await requireRole(mockReq, MANAGER_ROLES)
    expect('response' in result).toBe(true)
    if ('response' in result) {
      expect(result.response.status).toBe(403)
    }
  })

  it('Yeterli rolle requireRole employee döner', async () => {
    const mockEmployee = {
      id: 'emp-002',
      full_name: 'Müdür',
      email: 'mudur@test.com',
      role: 'Mağaza Müdürü',
      role_id: '00000000-0000-0000-0000-000000000002',
      role_name: ROLES.MAGAZA_MUDURU,
      active: true,
    }
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue(mockEmployee),
    }))
    const { requireRole } = await import('@/lib/auth/authorization')

    const mockReq = {
      cookies: { get: vi.fn().mockReturnValue({ value: '{"employeeId":"emp-002"}' }) },
    } as never

    const result = await requireRole(mockReq, MANAGER_ROLES)
    expect('employee' in result).toBe(true)
    if ('employee' in result) {
      expect(result.employee.id).toBe('emp-002')
    }
  })
})
