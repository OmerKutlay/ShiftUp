/**
 * authorization.test.ts — RBAC helper unit testleri
 *
 * getCurrentEmployee() DB çağrısı gerektirdiğinden mock'lanır.
 * hasRole(), roleAtLeast() saf fonksiyon — doğrudan test edilir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasRole, roleAtLeast, ACCESS, MANAGER_ROLES, type AccessLevel } from '@/lib/auth'

// ─── roleAtLeast ──────────────────────────────────────────────
describe('roleAtLeast', () => {
  it('Yönetici tüm rollerin üzerinde', () => {
    expect(roleAtLeast(ACCESS.ADMIN, ACCESS.EMPLOYEE)).toBe(true)
    expect(roleAtLeast(ACCESS.ADMIN, ACCESS.MANAGER)).toBe(true)
    expect(roleAtLeast(ACCESS.ADMIN, ACCESS.STORE_MANAGER)).toBe(true)
    expect(roleAtLeast(ACCESS.ADMIN, ACCESS.ADMIN)).toBe(true)
  })

  it('Çalışan yalnızca kendi seviyesinde', () => {
    expect(roleAtLeast(ACCESS.EMPLOYEE, ACCESS.EMPLOYEE)).toBe(true)
    expect(roleAtLeast(ACCESS.EMPLOYEE, ACCESS.MANAGER)).toBe(false)
    expect(roleAtLeast(ACCESS.EMPLOYEE, ACCESS.STORE_MANAGER)).toBe(false)
    expect(roleAtLeast(ACCESS.EMPLOYEE, ACCESS.ADMIN)).toBe(false)
  })

  it('Müdür Yardımcısı Çalışan seviyesinin üstünde', () => {
    expect(roleAtLeast(ACCESS.MANAGER, ACCESS.EMPLOYEE)).toBe(true)
    expect(roleAtLeast(ACCESS.MANAGER, ACCESS.MANAGER)).toBe(true)
    expect(roleAtLeast(ACCESS.MANAGER, ACCESS.STORE_MANAGER)).toBe(false)
  })

  it('Tanımlanmamış yetki seviyesi false döner', () => {
    expect(roleAtLeast('bilinmeyen' as AccessLevel, ACCESS.EMPLOYEE)).toBe(false)
  })
})

// ─── hasRole ─────────────────────────────────────────────────
describe('hasRole', () => {
  it('Employee rolü izin listesinde varsa true', () => {
    expect(hasRole(ACCESS.STORE_MANAGER, MANAGER_ROLES)).toBe(true)
    expect(hasRole(ACCESS.ADMIN, MANAGER_ROLES)).toBe(true)
    expect(hasRole(ACCESS.MANAGER, MANAGER_ROLES)).toBe(true)
  })

  it('Çalışan MANAGER_ROLES listesinde değil', () => {
    expect(hasRole(ACCESS.EMPLOYEE, MANAGER_ROLES)).toBe(false)
  })

  it('null/undefined rol false döner', () => {
    expect(hasRole(null, MANAGER_ROLES)).toBe(false)
    expect(hasRole(undefined, MANAGER_ROLES)).toBe(false)
  })

  it('Boş izin listesi her zaman false', () => {
    expect(hasRole(ACCESS.ADMIN, [])).toBe(false)
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
        role_id: '00000000-0000-0000-0000-000000000004',
        access_level: ACCESS.EMPLOYEE,
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
      role_id: '00000000-0000-0000-0000-000000000002',
      access_level: ACCESS.STORE_MANAGER,
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
