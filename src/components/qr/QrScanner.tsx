'use client'

import { useEffect, useRef, useState } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner'
import { PermissionHelp } from './scanPageHelpers'

interface Props {
  onScan: (data: string) => void
  onError?: (error: string) => void
  active?: boolean
}

// html5-qrcode durum değerleri: 2 = SCANNING, 3 = PAUSED
const RUNNING_STATES = [2, 3]

interface ScannerInstance {
  stop: () => Promise<void>
  getState: () => number
}

// stop() tarayıcı çalışmıyorsa senkron olarak hata fırlatır (ör. kamera izni reddedildiğinde),
// bu yüzden durum kontrolü + try/catch ile güvenli şekilde durduruyoruz
function safeStop(scanner: ScannerInstance | null) {
  if (!scanner) return
  try {
    if (RUNNING_STATES.includes(scanner.getState())) {
      scanner.stop().catch(() => null)
    }
  } catch {
    // zaten durmuş — yok say
  }
}

export function QrScanner({ onScan, onError, active = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<ScannerInstance | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [permissionDenied, setPermissionDenied] = useState(false)

  useEffect(() => {
    if (!active) {
      safeStop(scannerRef.current)
      scannerRef.current = null
      return
    }

    let mounted = true

    // Kamera API'si yalnızca güvenli bağlamda (HTTPS / localhost) çalışır; HTTP üzerinden
    // (ör. yerel ağ IP'si) sessizce başarısız olur — kullanıcıya açıkça söyle
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onError?.('Kamera için güvenli bağlantı (HTTPS) gerekli. Uygulamayı https:// adresinden açın.')
      return () => { mounted = false }
    }

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
          // start() sürerken unmount olduysa kamerayı açık bırakma
          if (!mounted) {
            safeStop(scanner)
            return
          }
          setInitializing(false)
        })
        .catch((err: unknown) => {
          if (scannerRef.current === scanner) scannerRef.current = null
          if (!mounted) return
          setInitializing(false)
          const message = (err instanceof Error ? `${err.name} ${err.message}` : String(err)).toLowerCase()
          if (
            message.includes('permission') ||
            message.includes('denied') ||
            message.includes('notallowed')
          ) {
            setPermissionDenied(true)
          } else {
            onError?.(err instanceof Error ? err.message : String(err))
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
      safeStop(scannerRef.current)
      scannerRef.current = null
    }
  }, [active, onScan, onError])

  if (permissionDenied) {
    return (
      <Box
        sx={{
          // Responsive: ekran genişliğine göre max 280px
          width: '100%',
          maxWidth: 320,
          minHeight: 280,
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
          QR taraması için kamera iznine ihtiyaç var.
        </Typography>
        {/* Cihaza / kurulu uygulamaya göre adım adım yönlendirme */}
        <PermissionHelp kind="camera" />
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
