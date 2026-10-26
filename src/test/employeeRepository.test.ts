import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EmployeeWithRole, Role } from '@/types/employee'

// ============================================================
// Supabase mock — gerçek DB çağrısı yapılmaz
// ============================================================
vi.mock('@/lib/db', () => ({
  db: {
    from: vi.fn(),
  },
}))

import {
  fetchEmployees,
  fetchActiveEmployees,
  fetchRoles,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
} from '@/lib/employeeRepository'
import { db as supabase } from '@/lib/db'

// ============================================================
// Yardımcı factory fonksiyonlar
// ============================================================
function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-001',
    name: 'Çalışan',
    description: 'Standart çalışan',
    access_level: 'employee',
    planning_group: null,
    sort_order: 40,
    created_at: '2026-09-28T00:00:00Z',
    ...overrides,
  }
}

function makeEmployee(overrides: Partial<EmployeeWithRole> = {}): EmployeeWithRole {
  return {
    id: 'emp-001',
    full_name: 'Ahmet Kaya',
    email: null,
    role_id: 'role-001',
    active: true,
    store_id: 'store-a',
    employment_type: 'full_time',
    auth_user_id: null,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    roles: makeRole(),
    ...overrides,
  }
}

// Chainable Supabase builder helper
function buildChain(terminal: Record<string, unknown>) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'or', 'order', 'insert', 'update', 'single', 'maybeSingle']
  methods.forEach((m) => {
    chain[m] = vi.fn(() => ({ ...chain, ...terminal }))
  })
  return { ...chain, ...terminal }
}

// ============================================================
// fetchRoles
// ============================================================
describe('employeeRepository — fetchRoles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rolleri döner', async () => {
    const roles = [makeRole()]
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: roles, error: null })
    )
    const result = await fetchRoles()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Çalışan')
  })

  it('hata durumunda fırlatır', async () => {
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: null, error: { message: 'DB hatası' } })
    )
    await expect(fetchRoles()).rejects.toThrow('Roller yüklenemedi')
  })
})

// ============================================================
// fetchEmployees
// ============================================================
describe('employeeRepository — fetchEmployees', () => {
  beforeEach(() => vi.clearAllMocks())

  it('1. Çalışan listesi yüklenebiliyor', async () => {
    const emps = [makeEmployee(), makeEmployee({ id: 'emp-002', full_name: 'Ayşe Demir' })]
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: emps, error: null })
    )
    const result = await fetchEmployees('store-a')
    expect(result).toHaveLength(2)
    expect(result[0].full_name).toBe('Ahmet Kaya')
  })

  it('yalnızca verilen mağazanın çalışanlarını sorgular (store_id filtresi)', async () => {
    const eq = vi.fn()
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.order = vi.fn(() => chain)
    chain.eq = eq.mockImplementation(() => chain)
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(chain)

    await fetchEmployees('store-b')
    expect(eq).toHaveBeenCalledWith('store_id', 'store-b')
  })

  it('boş liste döndürür (çalışan yok)', async () => {
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: [], error: null })
    )
    const result = await fetchEmployees('store-a')
    expect(result).toHaveLength(0)
  })
})

// ============================================================
// fetchActiveEmployees
// ============================================================
describe('employeeRepository — fetchActiveEmployees', () => {
  beforeEach(() => vi.clearAllMocks())

  it('5. Pasif çalışan aktif listede görünmez — sadece aktifler döner', async () => {
    const activeOnly = [makeEmployee({ active: true })]
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: activeOnly, error: null })
    )
    const result = await fetchActiveEmployees('store-a')
    expect(result.every((e) => e.active)).toBe(true)
  })

  it('aktif liste de mağaza filtresiyle sorgulanır', async () => {
    const eq = vi.fn()
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.or = vi.fn(() => chain)
    chain.order = vi.fn(() => chain)
    chain.eq = eq.mockImplementation(() => chain)
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(chain)

    await fetchActiveEmployees('store-b')
    expect(eq).toHaveBeenCalledWith('store_id', 'store-b')
    expect(eq).toHaveBeenCalledWith('active', true)
  })
})

// ============================================================
// createEmployee
// ============================================================
describe('employeeRepository — createEmployee', () => {
  beforeEach(() => vi.clearAllMocks())

  it('2. Çalışan oluşturulabiliyor', async () => {
    const newEmp = makeEmployee({ id: 'emp-new' })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: newEmp, error: null }),
    })

    const result = await createEmployee({
      full_name: 'Ahmet Kaya',
      email: 'ahmet.kaya@shiftup.test',
      role_id: 'role-001',
      active: true,
      employment_type: 'full_time',
      store_id: 'store-a',
    })

    expect(result.id).toBe('emp-new')
    expect(result.full_name).toBe('Ahmet Kaya')
  })

  it('hata durumunda fırlatır', async () => {
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'unique ihlali' } }),
    })
    await expect(
      createEmployee({ full_name: 'X', email: null, role_id: null, active: true, employment_type: 'full_time', store_id: 'store-a' })
    ).rejects.toThrow('Çalışan oluşturulamadı')
  })
})

// ============================================================
// updateEmployee
// ============================================================
describe('employeeRepository — updateEmployee', () => {
  beforeEach(() => vi.clearAllMocks())

  it('3. Çalışan düzenlenebiliyor', async () => {
    const updated = makeEmployee({ full_name: 'Ahmet Güncellendi' })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    })

    const result = await updateEmployee('emp-001', { full_name: 'Ahmet Güncellendi' })
    expect(result.full_name).toBe('Ahmet Güncellendi')
  })
})

// ============================================================
// deactivateEmployee
// ============================================================
describe('employeeRepository — deactivateEmployee', () => {
  beforeEach(() => vi.clearAllMocks())

  it('4. Pasif çalışan aktif:false olarak döner', async () => {
    const deactivated = makeEmployee({ active: false })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: deactivated, error: null }),
    })

    const result = await deactivateEmployee('emp-001')
    expect(result.active).toBe(false)
  })
})

// ============================================================
// Çalışan-Rol ilişkisi
// ============================================================
describe('employeeRepository — rol ilişkisi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('5b. Çalışan ile rol ilişkisi doğru geliyor', async () => {
    const empWithRole = makeEmployee({
      roles: makeRole({ name: 'Mağaza Müdürü' }),
    })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      buildChain({ data: [empWithRole], error: null })
    )

    const result = await fetchEmployees('store-a')
    expect(result[0].roles?.name).toBe('Mağaza Müdürü')
  })
})
