import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useSWR, { SWRConfig } from 'swr'

let pathname = '/my-schedule'
const { routerRefresh } = vi.hoisted(() => ({ routerRefresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: routerRefresh, push: vi.fn() }),
}))

import { AuthProvider, useAuth } from '@/context/AuthContext'
import { UNAUTHORIZED_EVENT } from '@/lib/api/http'

const replace = vi.fn()
const originalLocation = window.location

function Status() {
  return <span>{useAuth().status}</span>
}

const meOk = () =>
  new Response(JSON.stringify({ employee: { id: 'emp-1', active: true, roles: null } }), { status: 200 })

describe('AuthProvider oturum yönlendirmesi', () => {
  beforeEach(() => {
    pathname = '/my-schedule'
    replace.mockClear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, replace },
    })
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    vi.unstubAllGlobals()
  })

  it('oturum yoksa korumalı sayfadan giriş ekranına yönlendirir', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }))
    render(<AuthProvider><Status /></AuthProvider>)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fmy-schedule'))
  })

  it('giriş ekranındayken yönlendirmez', async () => {
    pathname = '/login'
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }))
    render(<AuthProvider><Status /></AuthProvider>)
    expect(await screen.findByText('unauthenticated')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('geçici sunucu hatasında yeniden dener, yönlendirmez', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(meOk())
    render(<AuthProvider><Status /></AuthProvider>)
    expect(await screen.findByText('authenticated', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('bir API 401 alınca oturumu yeniden doğrular ve düşmüşse yönlendirir', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(meOk())
    render(<AuthProvider><Status /></AuthProvider>)
    expect(await screen.findByText('authenticated')).toBeInTheDocument()

    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }))
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?next=%2Fmy-schedule'))
  })
})

describe('AuthProvider mağaza bağlamı', () => {
  const storeA = { active: { id: 'store-a', name: 'Kadıköy' }, home_store_id: 'store-a', can_switch: true }
  const storeB = { active: { id: 'store-b', name: 'Beşiktaş' }, home_store_id: 'store-a', can_switch: true }
  const me = (store: unknown) =>
    new Response(JSON.stringify({ employee: { id: 'emp-1', active: true, roles: null }, store }), { status: 200 })

  // Her test için izole SWR önbelleği
  const renderAuth = (ui: React.ReactElement) =>
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AuthProvider>{ui}</AuthProvider>
      </SWRConfig>
    )

  function StoreProbe() {
    const { store, switchStore } = useAuth()
    // Önbellekteki veri mağaza değişince sıfırlanıp yeniden çekilmeli
    const { data } = useSWR('probe', () => fetch('/api/probe').then((r) => r.text()))
    return (
      <>
        <span data-testid="store">{store?.active.name ?? 'yok'}</span>
        <span data-testid="can-switch">{String(store?.can_switch ?? false)}</span>
        <span data-testid="probe">{data ?? '-'}</span>
        <button onClick={() => void switchStore('store-b')}>değiştir</button>
      </>
    )
  }

  beforeEach(() => {
    pathname = '/my-schedule'
    routerRefresh.mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('/api/auth/me yanıtındaki mağaza bağlamını sunar', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input) === '/api/probe' ? new Response('x') : me(storeA)
    )
    renderAuth(<StoreProbe />)
    expect(await screen.findByText('Kadıköy')).toBeInTheDocument()
    expect(screen.getByTestId('can-switch')).toHaveTextContent('true')
  })

  it('store alanı yoksa null (eski yanıt)', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input) === '/api/probe' ? new Response('x') : meOk()
    )
    renderAuth(<StoreProbe />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('store')).toHaveTextContent('yok'))
  })

  it('switchStore: çerezi ayarlar, oturumu yeniler, önbelleği yeniden çeker, router.refresh çağırır', async () => {
    let active: 'a' | 'b' = 'a'
    let probeCalls = 0
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/stores/active') {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ store_id: 'store-b' })
        active = 'b'
        return new Response(JSON.stringify({ store: { id: 'store-b', name: 'Beşiktaş' } }), { status: 200 })
      }
      if (url === '/api/probe') {
        probeCalls++
        return new Response(active === 'a' ? 'veri-A' : 'veri-B', { status: 200 })
      }
      return me(active === 'a' ? storeA : storeB)
    })
    renderAuth(<StoreProbe />)
    expect(await screen.findByText('Kadıköy')).toBeInTheDocument()
    expect(await screen.findByText('veri-A')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'değiştir' }))

    expect(await screen.findByText('Beşiktaş')).toBeInTheDocument()
    expect(await screen.findByText('veri-B')).toBeInTheDocument()
    expect(probeCalls).toBeGreaterThanOrEqual(2)
    expect(routerRefresh).toHaveBeenCalled()
  })

  it('switchStore sunucu hatasında fırlatır ve bağlamı değiştirmez', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input) === '/api/stores/active'
        ? new Response(JSON.stringify({ error: 'Mağaza bulunamadı veya pasif.' }), { status: 404 })
        : me(storeA)
    )
    let thrown: unknown
    function Probe() {
      const { store, switchStore } = useAuth()
      return (
        <>
          <span>{store?.active.name ?? 'yok'}</span>
          <button onClick={() => switchStore('store-b').catch((e) => { thrown = e })}>değiştir</button>
        </>
      )
    }
    renderAuth(<Probe />)
    expect(await screen.findByText('Kadıköy')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'değiştir' }))
    await waitFor(() => expect(thrown).toBeInstanceOf(Error))
    expect((thrown as Error).message).toBe('Mağaza bulunamadı veya pasif.')
    expect(screen.getByText('Kadıköy')).toBeInTheDocument()
    expect(routerRefresh).not.toHaveBeenCalled()
  })
})
