import type { Metadata } from 'next'
import { Box, Typography } from '@mui/material'

export const metadata: Metadata = {
  title: 'Çevrimdışı',
}

/**
 * Service worker'ın ağ yokken sayfa gezinmelerinde gösterdiği yedek sayfa.
 * Statik olarak önbelleğe alınır (bkz. src/lib/pwa/serviceWorkerSource.ts).
 */
export default function OfflinePage() {
  return (
    <Box sx={{ minHeight: '60dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
      <Typography variant="h6" fontWeight={700}>
        İnternet bağlantısı yok
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 360 }}>
        Giriş/çıkış ve vardiya bilgileri için bağlantı gerekiyor. Bağlantı geri geldiğinde sayfayı yenileyin.
      </Typography>
    </Box>
  )
}
