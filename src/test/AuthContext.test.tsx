import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

let pathname = '/my-schedule'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
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
