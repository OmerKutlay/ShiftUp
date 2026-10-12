import type { Metadata } from 'next'
import { Box, Button, Typography } from '@mui/material'

export const metadata: Metadata = {
  title: 'Sayfa Bulunamadı',
}

export default function NotFound() {
  return (
    <Box sx={{ minHeight: '60dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
      <Typography variant="h3" fontWeight={800} color="primary.main">
        404
      </Typography>
      <Typography variant="h6" fontWeight={700} sx={{ mt: 1 }}>
        Sayfa bulunamadı
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3, maxWidth: 360 }}>
        Aradığınız sayfa taşınmış, silinmiş ya da hiç var olmamış olabilir.
      </Typography>
      <Button variant="contained" href="/my-schedule">
        Ana Sayfaya Dön
      </Button>
    </Box>
  )
}
