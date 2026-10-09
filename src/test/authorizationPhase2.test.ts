/**
 * authorizationPhase2.test.ts
 *
 * Availability, open-shifts, shift-swap, notifications için
 * temel authorization davranışlarını test eder.
 * getCurrentEmployee mock'lanır — DB çağrısı yoktur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ROLES, MANAGER_ROLES, hasRole } from '@/lib/auth'

// ─── hasRole — nav visibility ────────────────────────────────
describe('hasRole — UI visibility', () => {
  it('Müdür Yardımcısı MANAGER_ROLES içinde', () => {
    expect(hasRole(ROLES.MUDUR_YARDIMCISI, MANAGER_ROLES)).toBe(true)
  })

  it('Çalışan MANAGER_ROLES içinde değil', () => {
    expect(hasRole(ROLES.CALISAN, MANAGER_ROLES)).toBe(false)
  })

  it('Yönetici MANAGER_ROLES içinde', () => {
    expect(hasRole(ROLES.YONETICI, MANAGER_ROLES)).toBe(true)
  })
})

// ─── requireAuth — unauthenticated → 401 ────────────────────
describe('requireAuth — unauthenticated request', () => {
  beforeEach(() => vi.resetModules())

  it('session yok → 401', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue(null),
    }))
    const { requireAuth } = await import('@/lib/auth/authorization')
    const req = { cookies: { get: vi.fn().mockReturnValue(undefined) } } as never
    const result = await requireAuth(req)
    expect('response' in result).toBe(true)
    if ('response' in result) expect(result.response.status).toBe(401)
  })
})

// ─── canAccessEmployee — self-access ────────────────────────
describe('canAccessEmployee — self vs other', () => {
  beforeEach(() => vi.resetModules())

  it('Çalışan kendi ID ile erişebilir', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue({
        id: 'emp-001', full_name: 'Test', email: null,
        role: 'Kasiyer', role_id: null, role_name: ROLES.CALISAN, active: true,
      }),
    }))
    const { canAccessEmployee } = await import('@/lib/auth/authorization')
    const req = { cookies: { get: vi.fn() } } as never
    const result = await canAccessEmployee(req, 'emp-001', MANAGER_ROLES)
    expect('employee' in result).toBe(true)
  })

  it('Çalışan başka employee ID ile erişemez → 403', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue({
        id: 'emp-001', full_name: 'Test', email: null,
        role: 'Kasiyer', role_id: null, role_name: ROLES.CALISAN, active: true,
      }),
    }))
    const { canAccessEmployee } = await import('@/lib/auth/authorization')
    const req = { cookies: { get: vi.fn() } } as never
    const result = await canAccessEmployee(req, 'emp-002', MANAGER_ROLES)
    expect('response' in result).toBe(true)
    if ('response' in result) expect(result.response.status).toBe(403)
  })

  it('Mağaza Müdürü başka employee ID ile erişebilir', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue({
        id: 'emp-003', full_name: 'Müdür', email: null,
        role: 'Mağaza Müdürü', role_id: null, role_name: ROLES.MAGAZA_MUDURU, active: true,
      }),
    }))
    const { canAccessEmployee } = await import('@/lib/auth/authorization')
    const req = { cookies: { get: vi.fn() } } as never
    const result = await canAccessEmployee(req, 'emp-001', MANAGER_ROLES)
    expect('employee' in result).toBe(true)
  })
})

// ─── requireMinRole — open-shift create ─────────────────────
describe('requireMinRole — open shift management', () => {
  beforeEach(() => vi.resetModules())

  it('Çalışan open shift oluşturamaz → 403', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue({
        id: 'emp-001', full_name: 'Test', email: null,
        role: 'Kasiyer', role_id: null, role_name: ROLES.CALISAN, active: true,
      }),
    }))
    const { requireMinRole } = await import('@/lib/auth/authorization')
    const req = { cookies: { get: vi.fn() } } as never
    const result = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
    expect('response' in result).toBe(true)
    if ('response' in result) expect(result.response.status).toBe(403)
  })

  it('Müdür Yardımcısı open shift oluşturabilir', async () => {
    vi.doMock('@/lib/auth/session', () => ({
      getCurrentEmployee: vi.fn().mockResolvedValue({
        id: 'emp-002', full_name: 'Müdür Yrd', email: null,
        role: 'Müdür Yardımcısı', role_id: null, role_name: ROLES.MUDUR_YARDIMCISI, active: true,
      }),
    }))
    const { requireMinRole } = await import('@/lib/auth/authorization')
    const req = { cookies: { get: vi.fn() } } as never
    const result = await requireMinRole(req, ROLES.MUDUR_YARDIMCISI)
    expect('employee' in result).toBe(true)
  })
})
