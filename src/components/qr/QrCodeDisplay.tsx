'use client'

import { useEffect, useRef } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import QRCode from 'qrcode'

interface Props {
  data: string         // QR'a encode edilecek veri
  size?: number        // piksel (varsayılan 240)
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
        dark: '#0f172a',  // koyu arka plan rengiyle uyumlu
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
          width: size,
          height: size,
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
          width: size,
          height: size,
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
        borderRadius: 2,
        overflow: 'hidden',
        border: '3px solid',
        borderColor: 'primary.main',
        boxShadow: '0 0 20px rgba(20,184,166,0.25)',
        display: 'inline-block',
      }}
    >
      <canvas ref={canvasRef} width={size} height={size} />
    </Box>
  )
}
