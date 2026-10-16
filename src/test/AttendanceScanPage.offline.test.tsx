import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './helpers/renderWithProviders'

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }))
// Kamera bileşeni: yalnızca render edilip edilmediğini izle
vi.mock('next/dynamic', () => ({
  default: () => function QrScannerStub() {
    return <div data-testid="qr-scanner" />
  },
}))

import { useAuth } from '@/context/AuthContext'
import { AttendanceScanPage } from '@/components/qr/AttendanceScanPage'
import { permissionHelpSteps } from '@/components/qr/scanPageHelpers'

const mockedUseAuth = vi.mocked(useAuth)

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  })
}

function statusResponse() {
  return new Response(JSON.stringify({
    has_shift: true,
    shift_start: '09:00:00',
    shift_end: '17:00:00',
    current_status: 'shift_waiting',
    suggested_action: 'clock_in',
    allowed_actions: ['clock_in'],
  }), { status: 200 })
}

describe('AttendanceScanPage — çevrimdışı', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({
      status: 'authenticated',
      employee: { id: 'emp-1', full_name: 'Ayşe Yılmaz', role: 'Kasiyer' },
      signOut: vi.fn(),
      refreshEmployee: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>)
    vi.stubGlobal('fetch', vi.fn(async () => statusResponse()))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('çevrimdışıyken işlem butonları kapalı ve açıklama gösterilir; bağlantı gelince durum yenilenir', async () => {
    renderWithProviders(<AttendanceScanPage />)
    const button = await screen.findByRole('button', { name: /Giriş Yap/ })
    expect(button).toBeEnabled()

    setOnline(false)
    expect(screen.getByRole('button', { name: /Giriş Yap/ })).toBeDisabled()
    expect(screen.getByText(/İnternet bağlantısı yok/)).toBeInTheDocument()

    const callsBefore = vi.mocked(fetch).mock.calls.length
    setOnline(true)
    expect(screen.getByRole('button', { name: /Giriş Yap/ })).toBeEnabled()
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('tarama ekranında bağlantı koparsa kamera kapatılır', async () => {
    renderWithProviders(<AttendanceScanPage />)
    const button = await screen.findByRole('button', { name: /Giriş Yap/ })
    act(() => button.click())
    expect(await screen.findByTestId('qr-scanner')).toBeInTheDocument()

    setOnline(false)
    expect(screen.queryByTestId('qr-scanner')).not.toBeInTheDocument()
    expect(screen.getByText(/İnternet bağlantısı yok/)).toBeInTheDocument()
  })

  it('çevrimdışı açılışta ağ hatası anlaşılır mesajla gösterilir, tekrar dene kapalıdır', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    renderWithProviders(<AttendanceScanPage />)

    expect(await screen.findByText(/Sunucuya bağlanılamadı/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tekrar Dene/ })).toBeDisabled()
  })
})

describe('permissionHelpSteps', () => {
  it('iOS kurulu uygulama için Ayarlar → Safari yönlendirmesi', () => {
    expect(permissionHelpSteps('camera', 'ios', true)[0]).toContain('Ayarlar → Safari → Kamera')
  })
  it('Android tarayıcı için site ayarları yönlendirmesi', () => {
    expect(permissionHelpSteps('location', 'android', false).join(' ')).toContain('Site ayarları → Konum')
  })
  it('Android kurulu uygulama için uygulama izinleri', () => {
    expect(permissionHelpSteps('camera', 'android', true)[0]).toContain('Uygulama bilgisi')
  })
})
