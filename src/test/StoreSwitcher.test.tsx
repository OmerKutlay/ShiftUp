/**
 * StoreSwitcher — yalnızca Admin (can_switch) mağaza değiştirebilir; diğerleri sadece mağaza adını görür.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/renderWithProviders'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }))

vi.mock('@/lib/api/stores', () => ({
  STORES_KEY: '/api/stores',
  fetchStores: vi.fn(),
}))

const switchStore = vi.fn()
let mockStore: { active: { id: string; name: string }; home_store_id: string; can_switch: boolean } | null = null
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ status: 'authenticated', store: mockStore, switchStore }),
}))

import { SidebarProvider } from '@/components/ui/sidebar'
import { StoreSwitcher } from '@/components/stores/StoreSwitcher'
import * as storesApi from '@/lib/api/stores'

const stores = [
  { id: 'store-a', name: 'Kadıköy', active: true, created_at: '', updated_at: '', employee_count: 3 },
  { id: 'store-b', name: 'Beşiktaş', active: true, created_at: '', updated_at: '', employee_count: 2 },
  { id: 'store-c', name: 'Kapalı Şube', active: false, created_at: '', updated_at: '', employee_count: 0 },
]

const asAdmin = () => {
  mockStore = { active: { id: 'store-a', name: 'Kadıköy' }, home_store_id: 'store-a', can_switch: true }
}
const asStaff = () => {
  mockStore = { active: { id: 'store-a', name: 'Kadıköy' }, home_store_id: 'store-a', can_switch: false }
}

const renderSidebar = () =>
  renderWithProviders(<SidebarProvider><StoreSwitcher variant="sidebar" /></SidebarProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  mockStore = null
  switchStore.mockResolvedValue(undefined)
  vi.mocked(storesApi.fetchStores).mockResolvedValue({ stores, active_store_id: 'store-a' })
})

describe('StoreSwitcher (yan menü)', () => {
  it('Admin olmayanda değiştirici yok; yalnızca mağaza adı ve ana sayfa bağlantısı', () => {
    asStaff()
    renderSidebar()
    expect(screen.getByText('Kadıköy')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mağaza değiştir/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/')
    expect(storesApi.fetchStores).not.toHaveBeenCalled()
  })

  it('Admin için açılır menü: aktif mağaza işaretli, pasifler gizli, yönetim bağlantısı var', async () => {
    asAdmin()
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: /mağaza değiştir, aktif: kadıköy/i }))

    const current = await screen.findByRole('menuitem', { name: /kadıköy/i })
    expect(current).toHaveAttribute('aria-current', 'true')
    expect(await screen.findByRole('menuitem', { name: /beşiktaş/i })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('menuitem', { name: /kapalı şube/i })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /mağazaları yönet/i })).toHaveAttribute('href', '/settings?tab=stores')
  })

  it('başka mağaza seçilince switchStore çağrılır ve toast gösterilir', async () => {
    asAdmin()
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: /mağaza değiştir/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /beşiktaş/i }))

    await waitFor(() => expect(switchStore).toHaveBeenCalledWith('store-b'))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Aktif mağaza: Beşiktaş'))
  })

  it('zaten aktif olan mağaza seçilince bir şey yapmaz', async () => {
    asAdmin()
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: /mağaza değiştir/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /kadıköy/i }))
    expect(switchStore).not.toHaveBeenCalled()
  })

  it('geçiş başarısız olursa hata toast gösterir', async () => {
    asAdmin()
    switchStore.mockRejectedValue(new Error('Mağaza bulunamadı veya pasif.'))
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: /mağaza değiştir/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /beşiktaş/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Mağaza bulunamadı veya pasif.'))
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('StoreSwitcher (mobil üst çubuk)', () => {
  it('Admin olmayanda yalnızca küçük mağaza adı gösterilir', () => {
    asStaff()
    renderWithProviders(<StoreSwitcher variant="mobile" />)
    expect(screen.getByText('Kadıköy')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('Admin için mağaza adına dokununca değiştirici açılır ve seçim çalışır', async () => {
    asAdmin()
    renderWithProviders(<StoreSwitcher variant="mobile" />)
    await userEvent.click(screen.getByRole('button', { name: /mağaza değiştir, aktif: kadıköy/i }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /beşiktaş/i }))
    await waitFor(() => expect(switchStore).toHaveBeenCalledWith('store-b'))
  })

  it('mağaza bağlamı yoksa hiçbir şey çizmez', () => {
    mockStore = null
    const { container } = renderWithProviders(<StoreSwitcher variant="mobile" />)
    expect(container).toBeEmptyDOMElement()
  })
})
