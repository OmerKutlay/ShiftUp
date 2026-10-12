'use client'

import { useEffect, useRef } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import QRCode from 'qrcode'

interface Props {
  data: string
  /** Render çözünürlüğü (px). Canvas bu boyutta üretilir, CSS ile ölçeklenir. Varsayılan 240. */
  size?: number
  loading?: boolean
  expired?: boolean
}

export function QrCodeDisplay({ data, size = 240, loading = false, expired = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!data || loading || expired) return
    const canvas = canvasRef.current
    if (!canvas) return

    QRCode.toCanvas(canvas, data, {
      width: size,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#f8fafc',
      },
      errorCorrectionLevel: 'M',
    }).catch((err: unknown) => {
      console.error('QR kod oluşturulamadı:', err)
    })
  }, [data, size, loading, expired])

  if (loading) {
    return (
      <Box
        sx={{
          // Responsive: tam genişlik, maxWidth ile üst sınır
          width: '100%',
          maxWidth: size,
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'rgba(255,255,255,0.05)',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <CircularProgress color="primary" size={40} />
      </Box>
    )
  }

  if (expired) {
    return (
      <Box
        sx={{
          width: '100%',
          maxWidth: size,
          aspectRatio: '1 / 1',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'rgba(239,68,68,0.08)',
          borderRadius: 2,
          border: '2px solid',
          borderColor: 'rgba(239,68,68,0.4)',
          gap: 1,
        }}
      >
        <Typography variant="h4">⏱</Typography>
        <Typography variant="caption" color="error.main" fontWeight={600} textAlign="center">
          QR Süresi Doldu
        </Typography>
        <Typography variant="caption" color="text.secondary" textAlign="center" fontSize="0.65rem">
          Yenileniyor...
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        // Responsive wrapper: Paper içinde her zaman sığar
        width: '100%',
        maxWidth: size,
        borderRadius: 2,
        overflow: 'hidden',
        border: '3px solid',
        borderColor: 'primary.main',
        boxShadow: '0 0 20px rgba(20,184,166,0.25)',
      }}
    >
      {/*
       * Canvas: width/height attribute'u piksel çözünürlüğünü belirler.
       * CSS width:'100%' ile container'a göre scale edilir — mobilde taşmaz.
       */}
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
    </Box>
  )
}
