/**
 * StoresPanel — Ayarlar › Mağazalar: listeleme, ekleme, yeniden adlandırma, pasife alma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './helpers/renderWithProviders'
import { ApiError } from '@/lib/api/http'

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }))

vi.mock('@/lib/api/stores', () => ({
  STORES_KEY: '/api/stores',
  fetchStores: vi.fn(),
  createStore: vi.fn(),
  updateStore: vi.fn(),
}))

const refreshEmployee = vi.fn()
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    store: { active: { id: 'store-a', name: 'Kadıköy' }, home_store_id: 'store-a', can_switch: true },
    refreshEmployee,
  }),
}))

import { StoresPanel } from '@/components/stores/StoresPanel'
import * as api from '@/lib/api/stores'

const mk = (id: string, name: string, active: boolean, employee_count: number) =>
  ({ id, name, active, created_at: '', updated_at: '', employee_count })

const stores = [mk('store-a', 'Kadıköy', true, 3), mk('store-b', 'Beşiktaş', true, 2), mk('store-c', 'Kapalı Şube', false, 0)]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.fetchStores).mockResolvedValue({ stores, active_store_id: 'store-a' })
})

describe('StoresPanel', () => {
  it('mağazaları, durumlarını ve çalışan sayılarını listeler', async () => {
    renderWithProviders(<StoresPanel />)
    expect(await screen.findByText('Beşiktaş')).toBeInTheDocument()
    expect(screen.getByText('Kapalı Şube')).toBeInTheDocument()
    expect(screen.getAllByText('3 aktif çalışan').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Pasif').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Şu an çalışılan').length).toBeGreaterThan(0)
  })

  it('yeni mağaza ekler', async () => {
    vi.mocked(api.createStore).mockResolvedValue(mk('store-d', 'Kartal', true, 0))
    renderWithProviders(<StoresPanel />)
    await screen.findByText('Beşiktaş')

    await userEvent.click(screen.getByRole('button', { name: /mağaza ekle/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /mağaza adı/i }), '  Kartal ')
    await userEvent.click(within(dialog).getByRole('button', { name: /^ekle$/i }))

    await waitFor(() => expect(api.createStore).toHaveBeenCalledWith('Kartal'))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Kartal eklendi'))
    // Liste yeniden çekilir
    await waitFor(() => expect(vi.mocked(api.fetchStores).mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('boş ad gönderilmez', async () => {
    renderWithProviders(<StoresPanel />)
    await screen.findByText('Beşiktaş')
    await userEvent.click(screen.getByRole('button', { name: /mağaza ekle/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: /^ekle$/i }))
    expect(await within(dialog).findAllByText(/mağaza adı zorunludur/i)).not.toHaveLength(0)
    expect(api.createStore).not.toHaveBeenCalled()
  })

  it('aynı ad hatasını (409) diyalogda gösterir', async () => {
    vi.mocked(api.createStore).mockRejectedValue(
      new ApiError('Bu adla bir mağaza zaten var.', 'DUPLICATE_STORE_NAME', 409)
    )
    renderWithProviders(<StoresPanel />)
    await screen.findByText('Beşiktaş')
    await userEvent.click(screen.getByRole('button', { name: /mağaza ekle/i }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: /mağaza adı/i }), 'Beşiktaş')
    await userEvent.click(within(dialog).getByRole('button', { name: /^ekle$/i }))
    expect(await within(dialog).findByText('Bu adla bir mağaza zaten var.')).toBeInTheDocument()
  })

  it('mağazayı yeniden adlandırır', async () => {
    vi.mocked(api.updateStore).mockResolvedValue(mk('store-b', 'Beşiktaş Çarşı', true, 2))
    renderWithProviders(<StoresPanel />)
    await screen.findByText('Beşiktaş')

    await userEvent.click(screen.getAllByRole('button', { name: 'Beşiktaş işlemleri' })[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: /yeniden adlandır/i }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox', { name: /mağaza adı/i })
    await userEvent.clear(input)
    await userEvent.type(input, 'Beşiktaş Çarşı')
    await userEvent.click(within(dialog).getByRole('button', { name: /^kaydet$/i }))

    await waitFor(() => expect(api.updateStore).toHaveBeenCalledWith('store-b', { name: 'Beşiktaş Çarşı' }))
    await waitFor(() => expect(refreshEmployee).toHaveBeenCalled())
  })

  it('pasife almadan önce onay ister; sunucu hatası toast ile gösterilir', async () => {
    vi.mocked(api.updateStore).mockRejectedValue(
      new ApiError('Mağazada aktif çalışan var.', 'STORE_HAS_EMPLOYEES', 409)
    )
    renderWithProviders(<StoresPanel />)
    await screen.findByText('Beşiktaş')

    await userEvent.click(screen.getAllByRole('button', { name: 'Beşiktaş işlemleri' })[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: /pasife al/i }))
    expect(api.updateStore).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: /^pasife al$/i }))

    await waitFor(() => expect(api.updateStore).toHaveBeenCalledWith('store-b', { active: false }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Mağazada aktif çalışan var.'))
  })

  it('şu an çalışılan mağaza pasife alınamaz', async () => {
    renderWithProviders(<StoresPanel />)
    await screen.findByText('Beşiktaş')
    await userEvent.click(screen.getAllByRole('button', { name: 'Kadıköy işlemleri' })[0])
    expect(await screen.findByRole('menuitem', { name: /pasife al \(aktif mağaza\)/i })).toHaveAttribute('aria-disabled', 'true')
  })

  it('pasif mağazayı yeniden etkinleştirir', async () => {
    vi.mocked(api.updateStore).mockResolvedValue(mk('store-c', 'Kapalı Şube', true, 0))
    renderWithProviders(<StoresPanel />)
    await screen.findByText('Kapalı Şube')
    await userEvent.click(screen.getAllByRole('button', { name: 'Kapalı Şube işlemleri' })[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: /yeniden etkinleştir/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^etkinleştir$/i }))
    await waitFor(() => expect(api.updateStore).toHaveBeenCalledWith('store-c', { active: true }))
  })
})
