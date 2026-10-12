'use client'

/**
 * QrKioskPage — Evrensel Dinamik QR Kiosk
 *
 * Çalışan veya işlem tipi seçimi YOKTUR.
 * QR kodu tarandığında:
 *   - Authenticated employee session'dan belirlenir
 *   - İşlem tipi (giriş/mola/çıkış) mevcut duruma göre otomatik seçilir
 *
 * QR 10 saniyede bir ve her okutmadan (giriş/mola/çıkış) hemen sonra yenilenir.
 * Yenileme sırasında eski QR yeni gelene kadar ekranda kalır — boşluk/uyarı ekranı yoktur.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box, Typography, Alert, LinearProgress, Paper,
} from '@mui/material'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import { QrCodeDisplay } from './QrCodeDisplay'
import { formatInTimeZone } from '@/lib/dateUtils'

/** Ekranda bir QR'ın gösterilme süresi */
const REFRESH_SECONDS = 10
/**
 * Token'ın sunucudaki geçerlilik süresi. Gösterim süresinden uzun tutulur:
 * QR'ı son saniyede okutan çalışanın GPS alma + istek süresi için pay bırakır.
 * Token zaten tek kullanımlık; okutulduğu anda kiosk yenisini üretir.
 */
const TOKEN_TTL_SECONDS = 30
const STATUS_POLL_MS = 1500
const RETRY_DELAY_MS = 3000

export function QrKioskPage() {
  const [qrData, setQrData] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const tokenRef = useRef<string | null>(null)
  const generatingRef = useRef(false)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const generateRef = useRef<(() => Promise<void>) | undefined>(undefined)

  const clearTimers = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }

  const generateQr = useCallback(async () => {
    if (generatingRef.current) return
    generatingRef.current = true
    clearTimers()

    try {
      const res = await fetch('/api/qr/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kiosk: true, ttl_seconds: TOKEN_TTL_SECONDS }),
        credentials: 'same-origin',
      })

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? 'QR üretilemedi.')
      }

      const data = (await res.json()) as { token: string; qr_data: string }
      tokenRef.current = data.token
      setQrData(data.qr_data)
      setGeneratedAt(new Date())
      setSecondsLeft(REFRESH_SECONDS)
      setError(null)

      // Geri sayım
      countdownRef.current = setInterval(() => {
        setSecondsLeft((s) => Math.max(0, s - 1))
      }, 1000)

      refreshTimerRef.current = setTimeout(() => generateRef.current?.(), REFRESH_SECONDS * 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'QR üretilemedi.')
      refreshTimerRef.current = setTimeout(() => generateRef.current?.(), RETRY_DELAY_MS)
    } finally {
      generatingRef.current = false
    }
  }, [])

  useEffect(() => { generateRef.current = generateQr }, [generateQr])

  // Sayfa açılınca ilk QR üret (generateQr state'i yalnızca await sonrasında günceller)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void generateQr()
    return clearTimers
  }, [generateQr])

  // Ekran gizlenince QR üretimini durdur; tekrar görünür olunca hemen yenisini üret
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        clearTimers()
        tokenRef.current = null
      } else {
        void generateRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Gösterilen QR okutuldu mu? Okutulduysa hemen yenisini üret.
  useEffect(() => {
    let inFlight = false
    const poll = setInterval(async () => {
      const token = tokenRef.current
      // Ekran görünmüyorsa yoklama yapma (arka planda gereksiz istek)
      if (!token || inFlight || generatingRef.current || document.hidden) return
      inFlight = true
      try {
        const res = await fetch(`/api/qr/status?token=${encodeURIComponent(token)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = (await res.json()) as { used: boolean }
        if (data.used && tokenRef.current === token) void generateRef.current?.()
      } catch {
        // Ağ hatası — bir sonraki turda tekrar denenir
      } finally {
        inFlight = false
      }
    }, STATUS_POLL_MS)
    return () => clearInterval(poll)
  }, [])

  const progressValue = (secondsLeft / REFRESH_SECONDS) * 100
  const progressColor = secondsLeft <= 3 ? '#ef4444' : '#14b8a6'

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
            loading={!qrData}
          />
        </Box>

        {/* Süre göstergesi */}
        {qrData && (
          <Box sx={{ width: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="caption" color="text.secondary">Geçerlilik</Typography>
              <Typography variant="caption" fontWeight={700}
                color={secondsLeft <= 3 ? 'error.main' : 'text.secondary'}>
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
        {generatedAt && (
          <Typography variant="caption" color="text.disabled">
            Son yenilenme: {formatInTimeZone(generatedAt.toISOString())}
          </Typography>
        )}

        <Typography variant="caption" color="text.disabled" textAlign="center" sx={{ maxWidth: 260 }}>
          QR kod her {REFRESH_SECONDS} saniyede bir ve her okutmadan sonra otomatik yenilenir.
          Taramak için sisteme giriş yapmış olmanız gerekir.
        </Typography>
      </Paper>
    </Box>
  )
}
