'use client'

/**
 * QrKioskPage — Yerelde üretilen, zaman tabanlı imzalı QR (TOTP mantığı)
 *
 * Google Authenticator gibi: ortak gizli anahtar + 15 sn'lik zaman adımı → HMAC kodu.
 * Fark: gizli anahtar kalıcı değil, kısa ömürlü bir "access" anahtarıdır.
 *   - POST /api/kiosk/key → { key_id, secret, expires_at, server_time } (saatte ~1 istek)
 *   - Her 15 sn'de QR = "SU1.<key_id>.<step>.<HMAC-SHA256(secret, …)>" tarayıcıda hesaplanır
 *   - Anahtar bitmeden KEY_REFRESH_BEFORE_MS önce yenilenir; ağ hatasında mevcut anahtar
 *     süresi dolana kadar kullanılmaya devam eder (kiosk ekranı boş kalmaz)
 *   - Gizli anahtar yalnızca bellekte tutulur (localStorage yok); oturum (refresh) Supabase
 *     Auth çerezindedir — sayfa yenilenince yeni anahtar alınır.
 *
 * Çalışan, kendi telefonundaki "QR Tara" ekranıyla okutur; çalışan kimliği okutanın
 * oturumundan, işlem tipi onun seçiminden gelir.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Alert, LinearProgress, Paper, Button } from '@mui/material'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import LogoutIcon from '@mui/icons-material/Logout'
import { QrCodeDisplay } from './QrCodeDisplay'
import { useAuth } from '@/context/AuthContext'
import { isKioskRole } from '@/lib/auth/roles'

const QR_PREFIX = 'SU1'
const SIG_LENGTH = 22
/** Anahtar süresi dolmadan bu kadar önce yenilenir */
const KEY_REFRESH_BEFORE_MS = 5 * 60 * 1000
const RETRY_MIN_MS = 5_000
const RETRY_MAX_MS = 60_000

interface KioskKeyResponse {
  key_id: string
  secret: string
  expires_at: string
  step_seconds: number
  server_time: number
}

interface ActiveKey {
  id: string
  cryptoKey: CryptoKey
  expiresAt: number
  stepMs: number
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signStep(key: ActiveKey, step: number): Promise<string> {
  const body = `${QR_PREFIX}.${key.id}.${step}`
  const sig = await crypto.subtle.sign('HMAC', key.cryptoKey, new TextEncoder().encode(body))
  return `${body}.${bytesToBase64Url(new Uint8Array(sig)).slice(0, SIG_LENGTH)}`
}

export function QrKioskPage() {
  const router = useRouter()
  const { employee, signOut } = useAuth()
  const isKiosk = isKioskRole(employee?.roles?.name ?? employee?.role_name)

  const [qrData, setQrData] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [stepSeconds, setStepSeconds] = useState(15)
  const [error, setError] = useState<string | null>(null)

  const keyRef = useRef<ActiveKey | null>(null)
  /** Sunucu saati - kiosk saati (ms): kiosk saati yanlış olsa da pencere doğru hesaplanır */
  const offsetRef = useRef(0)
  const stepRef = useRef<number | null>(null)
  const loadingKeyRef = useRef(false)
  const retryMsRef = useRef(RETRY_MIN_MS)
  const keyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadKeyRef = useRef<() => Promise<void>>(async () => {})

  const scheduleKeyLoad = (delayMs: number) => {
    if (keyTimerRef.current) clearTimeout(keyTimerRef.current)
    keyTimerRef.current = setTimeout(() => void loadKeyRef.current(), Math.max(0, delayMs))
  }

  const loadKey = useCallback(async () => {
    if (loadingKeyRef.current) return
    loadingKeyRef.current = true
    try {
      const requestedAt = Date.now()
      const res = await fetch('/api/kiosk/key', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
      if (res.status === 401) {
        router.replace('/login?next=/qr-kiosk')
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Kiosk anahtarı alınamadı.')
      }
      const data = (await res.json()) as KioskKeyResponse
      // İstek süresinin yarısı kadar gecikme payıyla saat farkı
      offsetRef.current = data.server_time - (requestedAt + Date.now()) / 2

      const cryptoKey = await crypto.subtle.importKey(
        'raw', base64UrlToBytes(data.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      )
      const expiresAt = new Date(data.expires_at).getTime()
      keyRef.current = { id: data.key_id, cryptoKey, expiresAt, stepMs: data.step_seconds * 1000 }
      stepRef.current = null // yeni anahtarla hemen yeni kod
      setStepSeconds(data.step_seconds)
      setError(null)
      retryMsRef.current = RETRY_MIN_MS
      scheduleKeyLoad(expiresAt - KEY_REFRESH_BEFORE_MS - (Date.now() + offsetRef.current))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kiosk anahtarı alınamadı.')
      scheduleKeyLoad(retryMsRef.current)
      retryMsRef.current = Math.min(retryMsRef.current * 2, RETRY_MAX_MS)
    } finally {
      loadingKeyRef.current = false
    }
  }, [router])

  useEffect(() => { loadKeyRef.current = loadKey }, [loadKey])

  // İlk anahtar + saniyelik kod döngüsü (yalnızca yerel hesaplama, ağ isteği yok)
  useEffect(() => {
    void loadKeyRef.current()

    let cancelled = false
    const tick = async () => {
      const key = keyRef.current
      const now = Date.now() + offsetRef.current
      if (!key) return
      if (now >= key.expiresAt) {
        // Yenileme başarısız oldu ve anahtar bitti — eski kodu gösterme
        keyRef.current = null
        stepRef.current = null
        setQrData(null)
        void loadKeyRef.current()
        return
      }
      const step = Math.floor(now / key.stepMs)
      setSecondsLeft(Math.ceil((key.stepMs - (now % key.stepMs)) / 1000))
      if (step !== stepRef.current) {
        stepRef.current = step
        const data = await signStep(key, step)
        if (!cancelled && keyRef.current === key) setQrData(data)
      }
    }
    const interval = setInterval(() => void tick(), 250)
    return () => {
      cancelled = true
      clearInterval(interval)
      if (keyTimerRef.current) clearTimeout(keyTimerRef.current)
    }
  }, [])

  // Uyku/arka plandan dönünce anahtar bitmek üzereyse hemen yenile
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) return
      const key = keyRef.current
      if (!key || key.expiresAt - (Date.now() + offsetRef.current) < KEY_REFRESH_BEFORE_MS) {
        void loadKeyRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const progressValue = (secondsLeft / stepSeconds) * 100
  const progressColor = secondsLeft <= 3 ? '#ef4444' : '#14b8a6'

  return (
    <Box sx={{
      minHeight: '100dvh', bgcolor: '#0f172a', color: 'text.primary',
      p: { xs: 2, md: 4 }, position: 'relative',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <Box sx={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 1 }}>
        {!isKiosk && (
          <Button size="small" color="inherit" onClick={() => router.push('/')} sx={{ opacity: 0.5 }}>
            Panele dön
          </Button>
        )}
        <Button size="small" color="inherit" startIcon={<LogoutIcon fontSize="small" />}
          onClick={() => void signOut()} sx={{ opacity: 0.5 }}>
          Çıkış
        </Button>
      </Box>

      <Box sx={{ mb: 4, textAlign: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 0.5 }}>
          <QrCode2Icon sx={{ fontSize: 22, color: 'primary.main' }} />
          <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
            QR Kiosk
          </Typography>
        </Box>
        <Typography variant="h5" fontWeight={800}>Devam Takibi</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Telefonunuzda ShiftUp → QR Tara ile okutun
        </Typography>
      </Box>

      <Paper elevation={0} sx={{
        p: { xs: 3, md: 5 }, border: '1px solid', borderColor: 'divider',
        borderRadius: 3, bgcolor: 'background.paper', width: '100%', maxWidth: 400,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
      }}>
        {error && (
          <Alert severity={qrData ? 'warning' : 'error'} sx={{ width: '100%' }}>
            {qrData ? `${error} Mevcut kod geçerli, tekrar deneniyor.` : error}
          </Alert>
        )}

        <Box sx={{ width: '100%', maxWidth: 280, mx: 'auto' }}>
          <QrCodeDisplay data={qrData ?? ''} size={280} loading={!qrData} />
        </Box>

        {qrData && (
          <Box sx={{ width: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography variant="caption" color="text.secondary">Yeni kod</Typography>
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
                '& .MuiLinearProgress-bar': { bgcolor: progressColor, borderRadius: 3, transition: 'none' },
              }}
            />
          </Box>
        )}

        <Typography variant="caption" color="text.disabled" textAlign="center" sx={{ maxWidth: 260 }}>
          Kod her {stepSeconds} saniyede bir bu cihazda yenilenir; okutmak için ShiftUp&apos;a
          giriş yapmış olmanız gerekir.
        </Typography>
      </Paper>
    </Box>
  )
}
