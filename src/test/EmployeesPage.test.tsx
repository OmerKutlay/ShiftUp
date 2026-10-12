import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/renderWithProviders'
import type { EmployeeWithRole, Role } from '@/types/employee'

// ============================================================
// Mock repository
// ============================================================
vi.mock('@/lib/api/employees', () => ({
  fetchEmployees: vi.fn(),
  fetchRoles: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  deactivateEmployee: vi.fn(),
  activateEmployee: vi.fn(),
}))

// Mock Next.js router (AppShell bunu kullanıyor)
vi.mock('next/navigation', () => ({
  usePathname: () => '/employees',
  useRouter: () => ({ push: vi.fn() }),
}))

import { EmployeesPage } from '@/components/employees/EmployeesPage'
import * as repo from '@/lib/api/employees'

// ============================================================
// Helpers
// ============================================================
function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-001',
    name: 'Çalışan',
    description: null,
    created_at: '2026-09-28T00:00:00Z',
    ...overrides,
  }
}

function makeEmployee(overrides: Partial<EmployeeWithRole> = {}): EmployeeWithRole {
  return {
    id: 'emp-001',
    full_name: 'Ahmet Kaya',
    email: null,
    role: 'Kasiyer',
    role_id: 'role-001',
    active: true,
    employment_type: 'full_time',
    auth_user_id: null,
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-09-28T00:00:00Z',
    roles: makeRole(),
    ...overrides,
  }
}

function renderPage() {
  return renderWithProviders(<EmployeesPage />)
}

// ============================================================
// Tests
// ============================================================
describe('EmployeesPage — listeleme', () => {
  beforeEach(() => vi.clearAllMocks())

  it('1. Çalışan listesi yükleniyor ve görünüyor', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([makeEmployee()])
    vi.mocked(repo.fetchRoles).mockResolvedValue([makeRole()])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Ahmet Kaya')).toBeInTheDocument()
      expect(screen.getByText('Kasiyer')).toBeInTheDocument()
    })
  })

  it('Boş liste için bilgi mesajı gösterilir', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([])
    vi.mocked(repo.fetchRoles).mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/çalışan eklenmemiş/i)).toBeInTheDocument()
    })
  })

  it('Aktif çalışan sayısı header\'da gösterilir', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([
      makeEmployee({ active: true }),
      makeEmployee({ id: 'emp-002', full_name: 'Ayşe Demir', active: false }),
    ])
    vi.mocked(repo.fetchRoles).mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/1 aktif çalışan/i)).toBeInTheDocument()
    })
  })
})

describe('EmployeesPage — yeni çalışan ekleme', () => {
  beforeEach(() => vi.clearAllMocks())

  it('2. Yeni Çalışan butonuna tıklayınca dialog açılır', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([])
    vi.mocked(repo.fetchRoles).mockResolvedValue([makeRole()])

    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: /yeni çalışan/i })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /yeni çalışan/i }))

    expect(screen.getByText('Yeni Çalışan Ekle')).toBeInTheDocument()
  })

  it('3. Form submit edilince createEmployee çağrılır', async () => {
    const created = makeEmployee({ id: 'emp-new', full_name: 'Yeni Kişi' })
    vi.mocked(repo.fetchEmployees)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([created])
    vi.mocked(repo.fetchRoles).mockResolvedValue([makeRole()])
    vi.mocked(repo.createEmployee).mockResolvedValue(created)

    renderPage()

    await waitFor(() => screen.getByRole('button', { name: /yeni çalışan/i }))
    await userEvent.click(screen.getByRole('button', { name: /yeni çalışan/i }))

    await userEvent.type(screen.getByRole('textbox', { name: /ad soyad/i }), 'Yeni Kişi')
    await userEvent.type(screen.getByRole('textbox', { name: /pozisyon/i }), 'Kasiyer')

    await userEvent.click(screen.getByRole('button', { name: /^ekle$/i }))

    await waitFor(() => {
      expect(repo.createEmployee).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'Yeni Kişi', role: 'Kasiyer' })
      )
    })
  })
})

describe('EmployeesPage — düzenleme', () => {
  beforeEach(() => vi.clearAllMocks())

  it('4. Düzenle butonuna tıklayınca dialog açılır ve mevcut data gelir', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([makeEmployee()])
    vi.mocked(repo.fetchRoles).mockResolvedValue([makeRole()])

    renderPage()

    await waitFor(() => screen.getByText('Ahmet Kaya'))

    const editBtn = screen.getByRole('button', { name: /düzenle/i })
    await userEvent.click(editBtn)

    expect(screen.getByText('Çalışanı Düzenle')).toBeInTheDocument()
    // Mevcut veriler form'a yüklenmiş olmalı
    expect(screen.getByDisplayValue('Ahmet Kaya')).toBeInTheDocument()
  })
})

describe('EmployeesPage — pasif çalışan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('5. Pasif çalışan listede görünür ama "Pasif" chip ile işaretlenir', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([
      makeEmployee({ active: false }),
    ])
    vi.mocked(repo.fetchRoles).mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Ahmet Kaya')).toBeInTheDocument()
      // Chip olarak render edilen "Pasif" label'ı bul (role "status" yoktur, ama text içeriyor)
      const passiveChips = screen.getAllByText(/^Pasif$/)
      expect(passiveChips.length).toBeGreaterThanOrEqual(1)
    })
  })
})
