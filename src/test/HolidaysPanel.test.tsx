/**
 * HolidaysPanel — kapsam rozeti (Ulusal / Mağazaya özel), kapsam seçimi (Admin) ve yetkiye göre işlemler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/renderWithProviders'
import { turkeyToday } from '@/lib/dateUtils'

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/api/http', () => ({ apiFetch: vi.fn() }))

let mockAccess = 'store_manager'
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    employee: { id: 'e1', roles: { access_level: mockAccess } },
    store: { active: { id: 's1', name: 'Kadıköy' }, home_store_id: 's1', can_switch: mockAccess === 'admin' },
  }),
}))

import { HolidaysPanel } from '@/components/settings/HolidaysPanel'
import { apiFetch } from '@/lib/api/http'

const year = turkeyToday().slice(0, 4)
const holidays = [
  { id: 'h1', date: `${year}-10-29`, name: 'Cumhuriyet Bayramı', half_day: false, store_id: null },
  { id: 'h2', date: `${year}-11-15`, name: 'Mağaza yıldönümü', half_day: false, store_id: 's1' },
]

const calls = () => vi.mocked(apiFetch).mock.calls

beforeEach(() => {
  vi.clearAllMocks()
  mockAccess = 'store_manager'
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/holidays?from')) return { holidays }
    return {}
  })
})

describe('HolidaysPanel — çoklu mağaza', () => {
  it('her satırda kapsam rozeti gösterir', async () => {
    renderWithProviders(<HolidaysPanel />)
    await screen.findByText('Cumhuriyet Bayramı')
    expect(screen.getAllByText('Ulusal').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Mağazaya özel').length).toBeGreaterThan(0)
  })

  it('Mağaza Müdürü ulusal tatili değiştiremez; mağazaya özel tatili değiştirebilir', async () => {
    renderWithProviders(<HolidaysPanel />)
    await screen.findByText('Cumhuriyet Bayramı')
    expect(screen.queryByRole('button', { name: 'Cumhuriyet Bayramı işlemleri' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Mağaza yıldönümü işlemleri' }).length).toBeGreaterThan(0)
  })

  it('Mağaza Müdürü eklerken kapsam seçici görmez', async () => {
    renderWithProviders(<HolidaysPanel />)
    await screen.findByText('Cumhuriyet Bayramı')
    await userEvent.click(screen.getAllByRole('button', { name: /tatil ekle/i })[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('combobox', { name: /kapsam/i })).not.toBeInTheDocument()
  })

  it('Admin kapsam seçer (varsayılan Bu mağaza) ve ulusal tatili siler (scope=national)', async () => {
    mockAccess = 'admin'
    renderWithProviders(<HolidaysPanel />)
    await screen.findByText('Cumhuriyet Bayramı')

    // Ekleme: varsayılan kapsam "Bu mağaza"
    await userEvent.click(screen.getAllByRole('button', { name: /tatil ekle/i })[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('combobox', { name: /kapsam/i })).toHaveTextContent('Bu mağaza (Kadıköy)')
    await userEvent.click(within(dialog).getByRole('button', { name: 'İptal' }))

    // Silme: ulusal satır için scope=national gönderilir
    await userEvent.click(screen.getAllByRole('button', { name: 'Cumhuriyet Bayramı işlemleri' })[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: /sil/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^sil$/i }))
    await waitFor(() =>
      expect(calls().some(([url, init]) =>
        url === `/api/holidays?date=${year}-10-29&scope=national` && init?.method === 'DELETE'
      )).toBe(true)
    )
  })

  it('mağazaya özel tatil silinirken scope=store gönderilir', async () => {
    renderWithProviders(<HolidaysPanel />)
    await screen.findByText('Mağaza yıldönümü')
    await userEvent.click(screen.getAllByRole('button', { name: 'Mağaza yıldönümü işlemleri' })[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: /sil/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^sil$/i }))
    await waitFor(() =>
      expect(calls().some(([url, init]) =>
        url === `/api/holidays?date=${year}-11-15&scope=store` && init?.method === 'DELETE'
      )).toBe(true)
    )
  })
})
