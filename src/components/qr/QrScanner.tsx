'use client'

import { useEffect, useRef, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner'

interface Props {
  onScan: (data: string) => void
  onError?: (error: string) => void
  active?: boolean
}

export function QrScanner({ onScan, onError, active = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [permissionDenied, setPermissionDenied] = useState(false)

  useEffect(() => {
    if (!active) {
      scannerRef.current?.stop().catch(() => null)
      return
    }

    let mounted = true

    // html5-qrcode yalnızca browser'da çalışır, dynamic import gerekli
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (!mounted || !containerRef.current) return

      // Container gerçek genişliğine göre qrbox hesapla
      // Minimum 200, maksimum 260 — taşmayı önler
      const containerWidth = containerRef.current.offsetWidth || 280
      const qrboxSize = Math.min(Math.floor(containerWidth * 0.78), 260)

      const scanner = new Html5Qrcode('qr-scanner-container')
      scannerRef.current = scanner

      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: qrboxSize, height: qrboxSize } },
          (decodedText) => {
            onScan(decodedText)
          },
          () => {
            // QR bulunamadı — normal durum, loglamıyoruz
          }
        )
        .then(() => {
          if (mounted) setInitializing(false)
        })
        .catch((err: unknown) => {
          if (!mounted) return
          setInitializing(false)
          const message = err instanceof Error ? err.message : String(err)
          if (message.toLowerCase().includes('permission') || message.toLowerCase().includes('denied')) {
            setPermissionDenied(true)
          } else {
            onError?.(message)
          }
        })
    }).catch((err: unknown) => {
      if (mounted) {
        setInitializing(false)
        onError?.(err instanceof Error ? err.message : 'QR tarayıcı yüklenemedi.')
      }
    })

    return () => {
      mounted = false
      scannerRef.current?.stop().catch(() => null)
    }
  }, [active, onScan, onError])

  if (permissionDenied) {
    return (
      <Box
        sx={{
          // Responsive: ekran genişliğine göre max 280px
          width: '100%',
          maxWidth: 280,
          aspectRatio: '1 / 1',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'rgba(239,68,68,0.08)',
          borderRadius: 2,
          border: '2px solid rgba(239,68,68,0.3)',
          p: 2,
          gap: 1,
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <Typography variant="h4">🚫</Typography>
        <Typography variant="subtitle2" color="error.main" fontWeight={700}>
          Kamera izni gerekli
        </Typography>
        <Typography variant="caption" color="text.secondary">
          QR taraması için tarayıcı kamera iznine ihtiyaç duyar. Adres çubuğundaki kilit ikonundan
          izin ver.
        </Typography>
      </Box>
    )
  }

  return (
    // Dış wrapper: tam genişlik, max 280px — scanner her zaman container'a sığar
    <Box sx={{ width: '100%', maxWidth: 280, position: 'relative' }}>
      {/* html5-qrcode mount noktası — aspectRatio ile kare korunur */}
      <Box
        id="qr-scanner-container"
        ref={containerRef}
        sx={{
          width: '100%',
          aspectRatio: '1 / 1',
          borderRadius: 2,
          overflow: 'hidden',
          border: '3px solid',
          borderColor: 'primary.main',
          boxShadow: '0 0 20px rgba(20,184,166,0.25)',
          bgcolor: '#000',
          // html5-qrcode içine enjekte ettiği video/img elementleri için
          '& video': { width: '100% !important', height: '100% !important', objectFit: 'cover' },
          '& img': { display: 'none' }, // snapshot preview gizle
        }}
      />

      {/* Overlay tarama köşe işaretçileri */}
      {!initializing && (
        <Box
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            // Köşe işaretçileri container'ın %65'i kadar
            width: '65%',
            height: '65%',
            pointerEvents: 'none',
            '&::before, &::after': {
              content: '""',
              position: 'absolute',
              width: 28,
              height: 28,
              borderColor: 'primary.main',
              borderStyle: 'solid',
            },
            '&::before': {
              top: 0,
              left: 0,
              borderWidth: '3px 0 0 3px',
            },
            '&::after': {
              bottom: 0,
              right: 0,
              borderWidth: '0 3px 3px 0',
            },
          }}
        />
      )}

      {/* Loading overlay */}
      {initializing && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(15,23,42,0.85)',
            borderRadius: 2,
            gap: 1.5,
          }}
        >
          <CircularProgress color="primary" size={36} />
          <Typography variant="caption" color="text.secondary">
            Kamera açılıyor...
          </Typography>
        </Box>
      )}

      {/* Tarama ikonu */}
      {!initializing && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            bgcolor: 'rgba(15,23,42,0.7)',
            borderRadius: 1,
            p: 0.5,
            display: 'flex',
          }}
        >
          <QrCodeScannerIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        </Box>
      )}
    </Box>
  )
}
