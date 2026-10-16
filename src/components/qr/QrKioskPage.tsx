'use client'

/**
 * QrKioskPage — Tek kullanımlık kiosk QR'ı, Supabase Realtime Broadcast ile güncellenir.
 *
 * - Ekran private "kiosk-qr" kanalına abone olur (yalnızca aktif Kiosk / Müdür Yardımcısı+;
 *   yetki realtime.messages RLS politikasıyla veritabanında denetlenir).
 * - Abonelik kurulunca (ilk açılış ve her yeniden bağlanma) güncel kod GET /api/kiosk/qr ile
 *   bir kez alınır. Sonrasında kod yalnızca biri okutup onaylandığında, sunucunun yayınıyla değişir.
 * - Zamanlayıcı / periyodik istek yoktur.
 */
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Alert, Paper, Button, Chip } from '@mui/material'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import LogoutIcon from '@mui/icons-material/Logout'
import { QrCodeDisplay } from './QrCodeDisplay'
import { useAuth } from '@/context/AuthContext'
import { isKioskRole } from '@/lib/auth/roles'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'

const TOPIC = 'kiosk-qr'
const EVENT = 'qr'

type LinkState = 'connecting' | 'live' | 'offline'

export function QrKioskPage() {
  const router = useRouter()
  const { employee, signOut } = useAuth()
  const isKiosk = isKioskRole(employee?.roles?.name ?? employee?.role_name)

  const [qrData, setQrData] = useState<string | null>(null)
  const [link, setLink] = useState<LinkState>('connecting')
  const [error, setError] = useState<string | null>(null)
  /** Kod her değiştiğinde artar → QR kutusu kısa bir vurgu animasyonuyla yeniden çizilir */
  const [changeCount, setChangeCount] = useState(0)

  /** Her yayında artar: yayından eski bir GET yanıtı yeni kodun üzerine yazmasın */
  const versionRef = useRef(0)

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    let disposed = false

    const showQr = (data: string) => {
      setQrData((prev) => {
        if (prev && prev !== data) setChangeCount((n) => n + 1)
        return data
      })
    }

    const fetchCurrent = async () => {
      const startedAt = versionRef.current
      try {
        const res = await fetch('/api/kiosk/qr', { credentials: 'same-origin', cache: 'no-store' })
        if (res.status === 401) {
          router.replace('/login?next=/qr-kiosk')
          return
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? 'QR kodu alınamadı.')
        }
        const { qr_data } = (await res.json()) as { qr_data: string }
        if (!disposed && versionRef.current === startedAt) showQr(qr_data)
        setError(null)
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : 'QR kodu alınamadı.')
      }
    }

    const channel = supabase.channel(TOPIC, { config: { private: true } })

    const start = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (disposed) return
      if (!session) {
        setLink('offline')
        setError('Gerçek zamanlı bağlantı için oturum bulunamadı. Çıkış yapıp yeniden giriş yapın.')
        return
      }
      await supabase.realtime.setAuth(session.access_token)

      channel
        .on('broadcast', { event: EVENT }, ({ payload }) => {
          const data = (payload as { qr_data?: unknown })?.qr_data
          if (typeof data !== 'string') return
          versionRef.current += 1
          showQr(data)
        })
        .subscribe((status) => {
          if (disposed) return
          if (status === 'SUBSCRIBED') {
            setLink('live')
            // İlk açılış / yeniden bağlanma: arada kaçan yayınlar olabilir → güncel kodu bir kez al
            void fetchCurrent()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setLink('offline')
          }
        })
    }
    void start()

    return () => {
      disposed = true
      void supabase.removeChannel(channel)
    }
  }, [router])

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
          <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={0.5}>
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
        <Chip
          size="small"
          label={link === 'live' ? 'Canlı' : link === 'connecting' ? 'Bağlanıyor…' : 'Bağlantı yok — yeniden deneniyor'}
          color={link === 'live' ? 'success' : link === 'connecting' ? 'default' : 'error'}
          variant="outlined"
        />

        {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}

        <Box key={changeCount} sx={{
          width: '100%', maxWidth: 280, mx: 'auto', opacity: link === 'offline' ? 0.35 : 1,
          '@keyframes kioskQrSwap': { from: { opacity: 0.2, transform: 'scale(0.96)' }, to: { opacity: 1, transform: 'none' } },
          animation: changeCount > 0 ? 'kioskQrSwap 0.35s ease-out' : 'none',
        }}>
          <QrCodeDisplay data={qrData ?? ''} size={280} loading={!qrData} />
        </Box>

        <Typography variant="caption" color="text.disabled" textAlign="center" sx={{ maxWidth: 260 }}>
          Kod tek kullanımlıktır; biri okutup onaylandığında otomatik olarak yenisi gelir.
          Okutmak için ShiftUp&apos;a giriş yapmış olmanız gerekir.
        </Typography>
      </Paper>
    </Box>
  )
}
