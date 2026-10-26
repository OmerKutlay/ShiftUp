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

vi.mock('@/lib/api/stores', () => ({
  STORES_KEY: '/api/stores',
  fetchStores: vi.fn(),
}))

// Admin (can_switch) mağaza alanını görür; diğerleri görmez
let mockStoreCtx: { active: { id: string; name: string }; home_store_id: string; can_switch: boolean } | null = null
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ store: mockStoreCtx }),
}))

// jsdom'da yok; Radix RadioGroup / Switch (useSize) kullanıyor
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Mock Next.js router (AppShell bunu kullanıyor)
vi.mock('next/navigation', () => ({
  usePathname: () => '/employees',
  useRouter: () => ({ push: vi.fn() }),
}))

import { EmployeesPage } from '@/components/employees/EmployeesPage'
import * as repo from '@/lib/api/employees'
import * as storesApi from '@/lib/api/stores'

// ============================================================
// Helpers
// ============================================================
function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-001',
    name: 'Kasiyer',
    description: null,
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

  it('Aktif çalışan sayısı KPI kartında gösterilir', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([
      makeEmployee({ active: true }),
      makeEmployee({ id: 'emp-002', full_name: 'Ayşe Demir', active: false }),
    ])
    vi.mocked(repo.fetchRoles).mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      const card = screen.getByText('Aktif çalışan').closest('[data-slot="card"]')
      expect(card).toHaveTextContent(/Aktif çalışan\s*1/)
      expect(card).toHaveTextContent('1 pasif')
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

    expect(await screen.findByRole('heading', { name: 'Çalışan ekle' })).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('combobox', { name: /sistem rolü/i }))
    await userEvent.click(await screen.findByRole('option', { name: /kasiyer/i }))

    await userEvent.click(screen.getByRole('button', { name: /^ekle$/i }))

    await waitFor(() => {
      expect(repo.createEmployee).toHaveBeenCalledWith(
        expect.objectContaining({ full_name: 'Yeni Kişi', role_id: 'role-001' })
      )
    })
  })
})

describe('EmployeesPage — düzenleme', () => {
  beforeEach(() => vi.clearAllMocks())

  it('4. Satır menüsünden Düzenle seçilince dialog açılır ve mevcut data gelir', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([makeEmployee()])
    vi.mocked(repo.fetchRoles).mockResolvedValue([makeRole()])

    renderPage()

    await waitFor(() => screen.getByText('Ahmet Kaya'))

    await userEvent.click(screen.getByRole('button', { name: /ahmet kaya işlemleri/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /düzenle/i }))

    expect(await screen.findByRole('heading', { name: 'Çalışanı düzenle' })).toBeInTheDocument()
    // Mevcut veriler form'a yüklenmiş olmalı
    expect(screen.getByDisplayValue('Ahmet Kaya')).toBeInTheDocument()
  })
})

describe('EmployeesPage — pasif çalışan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('5. Pasif çalışan varsayılan "Aktif" görünümde yok; "Ayrılanlar" sekmesinde "Pasif" chip ile görünür', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([
      makeEmployee({ active: false }),
    ])
    vi.mocked(repo.fetchRoles).mockResolvedValue([])

    renderPage()

    await waitFor(() => expect(screen.getByText('Aktif çalışan')).toBeInTheDocument())
    expect(screen.queryByText('Ahmet Kaya')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Ayrılanlar'))
    await waitFor(() => {
      expect(screen.getByText('Ahmet Kaya')).toBeInTheDocument()
      expect(screen.getAllByText(/^Pasif$/).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('İşten ayrılan çalışan "Ayrıldı · tarih · neden" chip ile Ayrılanlar sekmesinde görünür', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([
      makeEmployee({ active: false, termination_date: '2026-01-31', termination_reason: 'istifa' }),
      makeEmployee({ id: 'emp-002', full_name: 'Zeynep Aktif' }),
    ])
    vi.mocked(repo.fetchRoles).mockResolvedValue([])

    renderPage()

    await waitFor(() => expect(screen.getByText('Zeynep Aktif')).toBeInTheDocument())
    expect(screen.queryByText('Ahmet Kaya')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Ayrılanlar'))
    await waitFor(() => {
      expect(screen.getByText('Ahmet Kaya')).toBeInTheDocument()
      expect(screen.getByText(/Ayrıldı · 31 Oca 2026 · İstifa/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Zeynep Aktif')).not.toBeInTheDocument()
  })
})

describe('EmployeesPage — mağaza (çoklu mağaza)', () => {
  const stores = [
    { id: 'store-a', name: 'Kadıköy', active: true, created_at: '', updated_at: '', employee_count: 3 },
    { id: 'store-b', name: 'Beşiktaş', active: true, created_at: '', updated_at: '', employee_count: 2 },
    { id: 'store-c', name: 'Kapalı Şube', active: false, created_at: '', updated_at: '', employee_count: 0 },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreCtx = null
    vi.mocked(storesApi.fetchStores).mockResolvedValue({ stores, active_store_id: 'store-a' })
    vi.mocked(repo.fetchRoles).mockResolvedValue([makeRole()])
  })

  const asAdmin = () => {
    mockStoreCtx = { active: { id: 'store-a', name: 'Kadıköy' }, home_store_id: 'store-a', can_switch: true }
  }

  it('Admin olmayanda Mağaza alanı yok', async () => {
    vi.mocked(repo.fetchEmployees).mockResolvedValue([])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /yeni çalışan/i }))
    await screen.findByRole('heading', { name: 'Çalışan ekle' })
    expect(screen.queryByRole('combobox', { name: /mağaza/i })).not.toBeInTheDocument()
    expect(storesApi.fetchStores).not.toHaveBeenCalled()
  })

  it('Admin yeni çalışanı aktif mağaza varsayılanıyla ekler', async () => {
    asAdmin()
    vi.mocked(repo.fetchEmployees).mockResolvedValue([])
    vi.mocked(repo.createEmployee).mockResolvedValue(makeEmployee({ id: 'emp-new' }))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /yeni çalışan/i }))

    const storeSelect = await screen.findByRole('combobox', { name: /mağaza/i })
    expect(storeSelect).toHaveTextContent('Kadıköy')

    await userEvent.type(screen.getByRole('textbox', { name: /ad soyad/i }), 'Yeni Kişi')
    await userEvent.click(screen.getByRole('combobox', { name: /sistem rolü/i }))
    await userEvent.click(await screen.findByRole('option', { name: /kasiyer/i }))
    await userEvent.click(screen.getByRole('button', { name: /^ekle$/i }))

    await waitFor(() =>
      expect(repo.createEmployee).toHaveBeenCalledWith(expect.objectContaining({ store_id: 'store-a' }))
    )
  })

  it('Admin mağaza değiştirince onay sonrası transfer eder; pasif mağaza listelenmez', async () => {
    asAdmin()
    vi.mocked(repo.fetchEmployees).mockResolvedValue([makeEmployee()])
    vi.mocked(repo.updateEmployee).mockResolvedValue(makeEmployee({ store_id: 'store-b' }))
    renderPage()
    await screen.findByText('Ahmet Kaya')
    await userEvent.click(screen.getByRole('button', { name: /ahmet kaya işlemleri/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /düzenle/i }))

    await userEvent.click(await screen.findByRole('combobox', { name: /mağaza/i }))
    expect(screen.queryByRole('option', { name: /kapalı şube/i })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: 'Beşiktaş' }))
    await userEvent.click(screen.getByRole('button', { name: /^kaydet$/i }))

    // Onay istenir; onaylanmadan kayıt yapılmaz
    expect(await screen.findByText(/Beşiktaş mağazasına taşınacak/)).toBeInTheDocument()
    expect(repo.updateEmployee).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /taşı ve kaydet/i }))

    await waitFor(() =>
      expect(repo.updateEmployee).toHaveBeenCalledWith('emp-001', expect.objectContaining({ store_id: 'store-b' }))
    )
  })

  it('Mağaza değişmediyse transfer onayı istenmez ve store_id gönderilmez', async () => {
    asAdmin()
    vi.mocked(repo.fetchEmployees).mockResolvedValue([makeEmployee()])
    vi.mocked(repo.updateEmployee).mockResolvedValue(makeEmployee())
    renderPage()
    await screen.findByText('Ahmet Kaya')
    await userEvent.click(screen.getByRole('button', { name: /ahmet kaya işlemleri/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /düzenle/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^kaydet$/i }))

    await waitFor(() => expect(repo.updateEmployee).toHaveBeenCalled())
    expect(vi.mocked(repo.updateEmployee).mock.calls[0][1]).not.toHaveProperty('store_id')
  })
})
