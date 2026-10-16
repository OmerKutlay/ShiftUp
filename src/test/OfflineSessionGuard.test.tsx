import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }))

import { useAuth } from '@/context/AuthContext'
import { OfflineSessionGuard } from '@/components/pwa/OfflineSessionGuard'
import { runBeforeSignOut } from '@/lib/pwa/sessionEvents'
import { setSnapshot, getSnapshot, getSnapshotOwner } from '@/lib/pwa/offlineSnapshot'

const mockedUseAuth = vi.mocked(useAuth)
const refreshEmployee = vi.fn(async () => {})

function auth(
  status: string,
  employeeId: string | null,
  check: 'authenticated' | 'signed-out' | 'unreachable' | null = null,
) {
  mockedUseAuth.mockReturnValue({
    status,
    employee: employeeId ? { id: employeeId } : null,
    sessionCheck: check ? { result: check, at: Date.now() } : null,
    signOut: vi.fn(),
    refreshEmployee,
  } as unknown as ReturnType<typeof useAuth>)
}

describe('OfflineSessionGuard', () => {
  beforeEach(() => {
    localStorage.clear()
    refreshEmployee.mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('çıkıştan önce tüm anlık görüntüleri siler', async () => {
    auth('authenticated', 'emp-1')
    const { unmount } = render(<OfflineSessionGuard />)
    setSnapshot('my-schedule', 'emp-1', { a: 1 })
    await runBeforeSignOut()
    expect(getSnapshot('my-schedule', 'emp-1')).toBeNull()
    expect(getSnapshotOwner()).toBeNull()
    unmount()
  })

  it('farklı çalışan giriş yapınca öncekinin anlık görüntüleri silinir', () => {
    setSnapshot('my-schedule', 'emp-1', { a: 1 })
    auth('authenticated', 'emp-2')
    render(<OfflineSessionGuard />)
    expect(localStorage.getItem('shiftup:offline:my-schedule:emp-1')).toBeNull()
    expect(getSnapshotOwner()).toBe('emp-2')
  })

  it('sunucu oturumu kesin reddederse siler, ulaşılamıyorsa korur', () => {
    setSnapshot('my-schedule', 'emp-1', { a: 1 })
    auth('unauthenticated', null, 'unreachable')
    const { rerender } = render(<OfflineSessionGuard />)
    expect(getSnapshot('my-schedule', 'emp-1')).not.toBeNull()

    auth('unauthenticated', null, 'signed-out')
    rerender(<OfflineSessionGuard />)
    expect(getSnapshot('my-schedule', 'emp-1')).toBeNull()
  })

  it('aynı durum tekrar gelse de yeni "signed-out" sorgusu siler (bağlantı geri geldi senaryosu)', () => {
    auth('unauthenticated', null, 'unreachable')
    const { rerender } = render(<OfflineSessionGuard />)
    setSnapshot('my-schedule', 'emp-1', { a: 1 })
    // status 'unauthenticated' değişmeden kalır; yalnızca sessionCheck nesnesi yenilenir
    auth('unauthenticated', null, 'signed-out')
    rerender(<OfflineSessionGuard />)
    expect(getSnapshot('my-schedule', 'emp-1')).toBeNull()
  })

  it('oturum bilinmiyorsa bağlantı gelince yeniden sorgular', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    auth('unauthenticated', null, 'unreachable')
    render(<OfflineSessionGuard />)
    expect(refreshEmployee).not.toHaveBeenCalled()
    onLine.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(refreshEmployee).toHaveBeenCalledTimes(1)
  })
})
