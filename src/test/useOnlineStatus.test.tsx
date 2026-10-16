import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { OfflineBanner, BACK_ONLINE_MS } from '@/components/pwa/OfflineBanner'

function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useOnlineStatus', () => {
  it('online/offline olaylarını izler', () => {
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
    setOnline(false)
    expect(result.current).toBe(false)
    setOnline(true)
    expect(result.current).toBe(true)
  })

  it('sunucu render\'ında true döner', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    function Probe() {
      return <span>{useOnlineStatus() ? 'online' : 'offline'}</span>
    }
    expect(renderToString(<Probe />)).toContain('online')
  })
})

describe('OfflineBanner', () => {
  it('çevrimdışıyken uyarı, bağlantı gelince kısa süre "geri geldi" gösterir', () => {
    vi.useFakeTimers()
    render(<OfflineBanner />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    setOnline(false)
    expect(screen.getByText('Bağlantı yok — bazı işlemler kullanılamaz')).toBeInTheDocument()

    setOnline(true)
    expect(screen.getByText('Bağlantı geri geldi')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(BACK_ONLINE_MS)
    })
    // Fade çıkış animasyonu
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.queryByText('Bağlantı geri geldi')).not.toBeInTheDocument()
  })
})
