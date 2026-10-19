'use client'

/**
 * OfflineBanner — Bağlantı koptuğunda ekranın altında ince bir uyarı bandı.
 *
 * Mobilde alt gezinme çubuğunun (BOTTOM_NAV_OVERLAY_OFFSET + safe-area) üstünde, masaüstünde alttan 16px yukarıda
 * durur; üstteki mobil bar'ı kapatmaz. Bağlantı geri gelince kısa bir "geri geldi" mesajı
 * gösterip kaybolur.
 */
import { useEffect, useState } from 'react'
import { Alert, Box, Fade } from '@mui/material'
import WifiOffIcon from '@mui/icons-material/WifiOff'
import WifiIcon from '@mui/icons-material/Wifi'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { BOTTOM_NAV_OVERLAY_OFFSET } from '@/components/layout/MobileBottomNav'

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

  return (
    <Fade in={visible} unmountOnExit>
      <Box
        role="status"
        aria-live="polite"
        sx={{
          position: 'fixed',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: { xs: `calc(${BOTTOM_NAV_OVERLAY_OFFSET}px + env(safe-area-inset-bottom))`, md: 16 },
          zIndex: (theme) => theme.zIndex.snackbar,
          width: 'max-content',
          maxWidth: 'calc(100vw - 32px)',
          pointerEvents: 'none',
        }}
      >
        {online ? (
          <Alert severity="success" icon={<WifiIcon fontSize="small" />} variant="filled"
            sx={{ py: 0, borderRadius: 2, boxShadow: 3 }}>
            Bağlantı geri geldi
          </Alert>
        ) : (
          <Alert severity="warning" icon={<WifiOffIcon fontSize="small" />} variant="filled"
            sx={{ py: 0, borderRadius: 2, boxShadow: 3 }}>
            Bağlantı yok — bazı işlemler kullanılamaz
          </Alert>
        )}
      </Box>
    </Fade>
  )
}
