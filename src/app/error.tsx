'use client'

/**
 * Segment hata sınırı — bir sayfa render sırasında hata verirse gösterilir.
 * Uygulama kabuğu (menü) çalışmaya devam eder; kullanıcı sayfayı yeniden deneyebilir.
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { Box, Button, Paper, Typography } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error('[app/error]', error)
  }, [error])

  return (
    <Box sx={{ minHeight: '60dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Paper
        elevation={0}
        role="alert"
        sx={{ p: { xs: 3, md: 4 }, maxWidth: 440, width: '100%', textAlign: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
      >
        <ErrorOutlineIcon sx={{ fontSize: 48, color: 'error.main', mb: 1 }} aria-hidden />
        <Typography variant="h6" fontWeight={700} gutterBottom>
          Bir şeyler ters gitti
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Sayfa yüklenirken beklenmeyen bir hata oluştu. Tekrar deneyebilir veya ana sayfaya dönebilirsiniz.
          {error.digest && (
            <Box component="span" sx={{ display: 'block', mt: 1, fontFamily: 'monospace', fontSize: '0.75rem' }}>
              Hata kodu: {error.digest}
            </Box>
          )}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={() => retry()}>
            Tekrar Dene
          </Button>
          <Button variant="outlined" component={Link} href="/my-schedule">
            Ana Sayfa
          </Button>
        </Box>
      </Paper>
    </Box>
  )
}
