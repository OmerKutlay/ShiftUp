import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { format, startOfMonth } from 'date-fns'
import { renderWithProviders } from './helpers/renderWithProviders'

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }))

import { useAuth } from '@/context/AuthContext'
import { MySchedulePage } from '@/components/my-schedule/MySchedulePage'
import { setSnapshot, claimSnapshotOwner } from '@/lib/pwa/offlineSnapshot'

const mockedUseAuth = vi.mocked(useAuth)
const EMP = { id: 'emp-1', full_name: 'Ayşe Yılmaz', roles: { name: 'Kasiyer' } }
const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')

function row(overrides: Record<string, unknown> = {}) {
  return {
    work_date: monthStart,
    start_time: '09:00:00',
    end_time: '17:00:00',
    shift_name: null,
    status: 'clocked_out',
    clock_in_at: `${monthStart}T06:00:00Z`,
    clock_out_at: `${monthStart}T14:00:00Z`,
    break_start_at: null,
    break_end_at: null,
    worked_minutes: 450,
    break_minutes: 30,
    is_on_leave: false,
    ...overrides,
  }
}

function auth(status: 'authenticated' | 'unauthenticated', employee: typeof EMP | null) {
  mockedUseAuth.mockReturnValue({
    status, employee, signOut: vi.fn(), refreshEmployee: vi.fn(),
  } as unknown as ReturnType<typeof useAuth>)
}

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

function seedSnapshot(ownerId: string, savedAt = new Date().toISOString()) {
  setSnapshot(`my-schedule`, ownerId, {
    profile: { full_name: 'Kayıtlı Kişi', role_name: 'Kasiyer' },
    months: [{ month: monthStart, savedAt, rows: [row()] }],
  })
}

describe('MySchedulePage — çevrimdışı', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('başarılı yanıtı çalışan id ile anlık görüntüye yazar', async () => {
    setOnline(true)
    auth('authenticated', EMP)
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ rows: [row()] }), { status: 200 }))
    renderWithProviders(<MySchedulePage />)

    await waitFor(() => {
      expect(localStorage.getItem('shiftup:offline:my-schedule:emp-1')).not.toBeNull()
    })
    const stored = JSON.parse(localStorage.getItem('shiftup:offline:my-schedule:emp-1')!)
    expect(stored.ownerId).toBe('emp-1')
    expect(stored.data.months[0].month).toBe(monthStart)
    expect(stored.data.months[0].rows).toHaveLength(1)
    expect(screen.queryByText(/Çevrimdışı — son güncelleme/)).not.toBeInTheDocument()
  })

  it('ağ hatasında anlık görüntüden "Çevrimdışı — son güncelleme" ile gösterir', async () => {
    setOnline(false)
    auth('authenticated', EMP)
    seedSnapshot('emp-1')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    renderWithProviders(<MySchedulePage />)

    expect(await screen.findByText(/Çevrimdışı — son güncelleme:/)).toBeInTheDocument()
    expect(screen.getByText('Tamamlandı')).toBeInTheDocument()
  })

  it('navigator.onLine true olsa da fetch ağ hatası verirse anlık görüntüyü kullanır', async () => {
    setOnline(true)
    auth('authenticated', EMP)
    seedSnapshot('emp-1')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    renderWithProviders(<MySchedulePage />)

    expect(await screen.findByText(/Çevrimdışı — son güncelleme:/)).toBeInTheDocument()
  })

  it('sunucu hatası (ApiError) çevrimdışı sayılmaz — hata gösterilir', async () => {
    setOnline(true)
    auth('authenticated', EMP)
    seedSnapshot('emp-1')
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'Sunucu hatası' }), { status: 500 }))
    renderWithProviders(<MySchedulePage />)

    expect(await screen.findByText('Sunucu hatası')).toBeInTheDocument()
    expect(screen.queryByText(/Çevrimdışı — son güncelleme/)).not.toBeInTheDocument()
  })

  it('başka çalışanın anlık görüntüsünü asla göstermez', async () => {
    setOnline(false)
    auth('authenticated', EMP)
    seedSnapshot('emp-2')
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    renderWithProviders(<MySchedulePage />)

    expect(await screen.findByText(/bu ay için kaydedilmiş veri yok/)).toBeInTheDocument()
    expect(screen.queryByText(/Çevrimdışı — son güncelleme/)).not.toBeInTheDocument()
  })

  it('14 günden eski anlık görüntü gösterilmez', async () => {
    setOnline(false)
    auth('authenticated', EMP)
    seedSnapshot('emp-1', new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString())
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
    renderWithProviders(<MySchedulePage />)

    expect(await screen.findByText(/bu ay için kaydedilmiş veri yok/)).toBeInTheDocument()
  })

  it('çevrimdışı açılışta (oturum doğrulanamadı) cihaz sahibinin anlık görüntüsünü gösterir', async () => {
    setOnline(false)
    auth('unauthenticated', null)
    seedSnapshot('emp-1')
    renderWithProviders(<MySchedulePage />)

    expect(await screen.findByText(/Çevrimdışı — son güncelleme:/)).toBeInTheDocument()
    expect(screen.getByText('Kayıtlı Kişi · Kasiyer')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('çevrimiçi ve oturum yoksa anlık görüntü gösterilmez', () => {
    setOnline(true)
    auth('unauthenticated', null)
    claimSnapshotOwner('emp-1')
    seedSnapshot('emp-1')
    renderWithProviders(<MySchedulePage />)

    expect(screen.getByText('Bu sayfayı görmek için giriş yapmanız gerekiyor.')).toBeInTheDocument()
  })
})
