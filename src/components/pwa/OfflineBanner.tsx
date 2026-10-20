'use client'

/**
 * OfflineBanner — Bağlantı koptuğunda ekranın altında ince bir uyarı bandı.
 *
 * Mobilde alt gezinme çubuğunun (BOTTOM_NAV_OVERLAY_OFFSET + safe-area) üstünde, masaüstünde alttan 16px yukarıda
 * durur; üstteki mobil bar'ı kapatmaz. Bağlantı geri gelince kısa bir "geri geldi" mesajı
 * gösterip kaybolur.
 */
import { useEffect, useState } from 'react'
import { Wifi, WifiOff } from 'lucide-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { BOTTOM_NAV_OVERLAY_OFFSET } from '@/components/layout/MobileBottomNav'
import { cn } from '@/lib/utils'

/** "Bağlantı geri geldi" mesajının ekranda kalma süresi */
export const BACK_ONLINE_MS = 3000

export function OfflineBanner() {
  const online = useOnlineStatus()
  const [prevOnline, setPrevOnline] = useState(online)
  const [showBackOnline, setShowBackOnline] = useState(false)

  // Çevrimdışı → çevrimiçi geçişini render sırasında yakala (effect içinde setState yerine)
  if (online !== prevOnline) {
    setPrevOnline(online)
    setShowBackOnline(online)
  }

  useEffect(() => {
    if (!showBackOnline) return
    const timer = setTimeout(() => setShowBackOnline(false), BACK_ONLINE_MS)
    return () => clearTimeout(timer)
  }, [showBackOnline])

  const visible = !online || showBackOnline

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // Ters renkli (koyu) hap: içerikten ayrışır, toast'larla çakışmaz
        'pointer-events-none fixed left-1/2 z-[1400] flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background shadow-lg',
        'bottom-[calc(var(--overlay-offset)+env(safe-area-inset-bottom))] md:bottom-4',
        'animate-in fade-in-0 slide-in-from-bottom-2 duration-200 [&_svg]:size-4 [&_svg]:shrink-0'
      )}
      style={{ '--overlay-offset': `${BOTTOM_NAV_OVERLAY_OFFSET}px` } as React.CSSProperties}
    >
      {online ? (
        <>
          <Wifi aria-hidden className="text-success" />
          Bağlantı geri geldi
        </>
      ) : (
        <>
          <WifiOff aria-hidden className="text-warning" />
          Bağlantı yok — bazı işlemler kullanılamaz
        </>
      )}
    </div>
  )
}
