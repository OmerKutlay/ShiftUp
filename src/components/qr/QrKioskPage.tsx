'use client'

/**
 * QrKioskPage — Evrensel Dinamik QR Kiosk
 *
 * Çalışan veya işlem tipi seçimi YOKTUR.
 * QR kodu tarandığında:
 *   - Authenticated employee session'dan belirlenir
 *   - İşlem tipi (giriş/mola/çıkış) mevcut duruma göre otomatik seçilir
 *
 * QR 60 saniyede bir otomatik yenilenir.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box, Typography, Alert, LinearProgress, Paper,
} from '@mui/material'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import { QrCodeDisplay } from './QrCodeDisplay'
import { formatInTimeZone } from '@/lib/dateUtils'

const QR_TTL_SECONDS = 60
const REFRESH_INTERVAL_MS = QR_TTL_SECONDS * 1000

export function QrKioskPage() {
  const [qrData, setQrData] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [expired, setExpired] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const generateRef = useRef<(() => Promise<void>) | undefined>(undefined)

  const clearTimers = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }

  const generateQr = useCallback(async () => {
    clearTimers()
    setGenerating(true)
    setExpired(false)
    setError(null)

    try {
      const res = await fetch('/api/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kiosk: true, ttl_seconds: QR_TTL_SECONDS }),
        credentials: 'same-origin',
      })

      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'QR üretilemedi.')
      }

      const data = (await res.json()) as { qr_data: string; expires_at: string }
      setQrData(data.qr_data)
      setExpiresAt(new Date(data.expires_at))
      setSecondsLeft(QR_TTL_SECONDS)

      // Geri sayım
      countdownRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) { clearInterval(countdownRef.current!); return 0 }
          return s - 1
        })
      }, 1000)

      // Süre dolunca expired → 1.5s sonra yenile
      refreshTimerRef.current = setTimeout(() => {
        setExpired(true)
        setTimeout(() => generateRef.current?.(), 1500)
      }, REFRESH_INTERVAL_MS)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QR üretilemedi.')
    } finally {
      setGenerating(false)
    }
  }, [])

  useEffect(() => { generateRef.current = generateQr }, [generateQr])

  // Sayfa açılınca ilk QR üret
  useEffect(() => {
    void generateQr()
    return clearTimers
  }, [generateQr])

  const progressValue = (secondsLeft / QR_TTL_SECONDS) * 100
  const progressColor = secondsLeft <= 10 ? '#ef4444' : '#14b8a6'

  return (
    <Box sx={{
      minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary',
      p: { xs: 2, md: 4 },
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Header */}
      <Box sx={{ mb: 4, textAlign: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 0.5 }}>
          <QrCode2Icon sx={{ fontSize: 22, color: 'primary.main' }} />
          <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
            QR Kiosk
          </Typography>
        </Box>
        <Typography variant="h5" fontWeight={800}>Devam Takibi</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          QR kodu telefonunuzla tarayın
        </Typography>
      </Box>

      <Paper elevation={0} sx={{
        p: { xs: 3, md: 5 }, border: '1px solid', borderColor: 'divider',
        borderRadius: 3, bgcolor: 'background.paper', width: '100%', maxWidth: 400,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      }}>
        {error && (
          <Alert severity="error" sx={{ width: '100%' }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* QR kod */}
        <Box sx={{ width: '100%', maxWidth: 280, mx: 'auto' }}>
          <QrCodeDisplay
            data={qrData ?? ''}
            size={280}
            loading={generating}
            expired={expired}
          />
        </Box>

        {/* Süre göstergesi */}
        {!expired && !generating && qrData && (
          <Box sx={{ width: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="caption" color="text.secondary">Geçerlilik</Typography>
              <Typography variant="caption" fontWeight={700}
                color={secondsLeft <= 10 ? 'error.main' : 'text.secondary'}>
                {secondsLeft}s
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={progressValue}
              sx={{
                height: 5, borderRadius: 3,
                bgcolor: 'rgba(255,255,255,0.06)',
                '& .MuiLinearProgress-bar': { bgcolor: progressColor, borderRadius: 3 },
              }}
            />
          </Box>
        )}

        {/* Son yenilenme */}
        {expiresAt && !generating && (
          <Typography variant="caption" color="text.disabled">
            Son yenilenme: {formatInTimeZone(
              new Date(expiresAt.getTime() - QR_TTL_SECONDS * 1000).toISOString()
            )}
          </Typography>
        )}

        <Typography variant="caption" color="text.disabled" textAlign="center" sx={{ maxWidth: 260 }}>
          QR kod her {QR_TTL_SECONDS} saniyede bir otomatik yenilenir.
          Taramak için sisteme giriş yapmış olmanız gerekir.
        </Typography>
      </Paper>
    </Box>
  )
}
