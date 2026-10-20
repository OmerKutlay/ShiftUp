'use client'

/**
 * QrKioskPage — Tek kullanımlık kiosk QR'ı, Supabase Realtime Broadcast ile güncellenir.
 *
 * - Ekran private "kiosk-qr" kanalına abone olur (yalnızca aktif Kiosk / Müdür Yardımcısı+;
 *   yetki realtime.messages RLS politikasıyla veritabanında denetlenir).
 * - Abonelik kurulunca (ilk açılış ve her yeniden bağlanma) güncel kod GET /api/kiosk/qr ile
 *   bir kez alınır. Sonrasında kod yalnızca biri okutup onaylandığında, sunucunun yayınıyla değişir.
 * - Zamanlayıcı / periyodik istek yoktur.
 * - Tarayıcı çevrimdışıyken bağlantı geri gelince (online olayı) güncel kod yine bir kez alınır.
 * - Sayfa görünürken ekran kilidi (Screen Wake Lock) istenir; destek yoksa sessizce atlanır.
 *   "Tam ekran" butonu yalnızca Fullscreen API destekleniyorsa ve zaten tam ekran / kurulu
 *   uygulama değilse görünür.
 */
import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, LayoutDashboard, Loader2, LogOut, Maximize, WifiOff } from 'lucide-react'
import { QrCodeDisplay } from './QrCodeDisplay'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { BrandMark } from '@/components/common/BrandMark'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { isKioskRole } from '@/lib/auth/roles'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { isStandaloneDisplay } from '@/lib/pwa/deviceInfo'

const TOPIC = 'kiosk-qr'
const EVENT = 'qr'

type LinkState = 'connecting' | 'live' | 'offline'

// ─── Ekran kilidi (Screen Wake Lock) ──────────────────────────

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

/**
 * Sayfa görünürken ekranın kararmasını engeller. Kilit sekme gizlenince tarayıcı tarafından
 * bırakılır; görünür olunca (visibilitychange) yeniden istenir. Destek yoksa / reddedilirse no-op.
 */
function useScreenWakeLock() {
  useEffect(() => {
    const nav = navigator as WakeLockNavigator
    if (!nav.wakeLock) return
    let sentinel: WakeLockSentinelLike | null = null
    let disposed = false

    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      try {
        const lock = await nav.wakeLock!.request('screen')
        if (disposed) {
          void lock.release().catch(() => null)
          return
        }
        sentinel = lock
      } catch {
        // Pil tasarrufu / izin politikası reddedebilir — ekran normal davranır
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => null)
      sentinel = null
    }
  }, [])
}

// ─── Tam ekran ────────────────────────────────────────────────

function subscribeFullscreen(callback: () => void) {
  document.addEventListener('fullscreenchange', callback)
  return () => document.removeEventListener('fullscreenchange', callback)
}

/** Tam ekran butonu gösterilmeli mi? (destek var, şu an tam ekran değil, kurulu uygulama değil) */
function getCanEnterFullscreen(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.fullscreenEnabled === true &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    !document.fullscreenElement &&
    !isStandaloneDisplay()
  )
}

function useCanEnterFullscreen(): boolean {
  return useSyncExternalStore(subscribeFullscreen, getCanEnterFullscreen, () => false)
}

function enterFullscreen() {
  try {
    void document.documentElement.requestFullscreen?.().catch(() => null)
  } catch {
    // kullanıcı hareketi gerekli / destek yok — yok say
  }
}

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

  useScreenWakeLock()
  const canEnterFullscreen = useCanEnterFullscreen()

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

    // Tarayıcı çevrimdışıyken kaçan yayınlar olabilir: bağlantı geri gelince güncel kodu bir kez al
    // (Realtime kendi yeniden bağlanmasında da alır; versionRef çakışan yanıtları ayıklar)
    const onOnline = () => {
      if (!disposed) void fetchCurrent()
    }
    window.addEventListener('online', onOnline)

    return () => {
      disposed = true
      window.removeEventListener('online', onOnline)
      void supabase.removeChannel(channel)
    }
  }, [router])

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-16 text-ink md:p-8">
      <div className="absolute top-3 right-3 flex gap-1">
        {canEnterFullscreen && (
          <Button variant="ghost" size="sm" onClick={enterFullscreen} className="text-ink-secondary">
            <Maximize />
            Tam ekran
          </Button>
        )}
        {!isKiosk && (
          <Button variant="ghost" size="sm" onClick={() => router.push('/')} className="text-ink-secondary">
            <LayoutDashboard />
            Panele dön
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => void signOut()} className="text-ink-secondary">
          <LogOut />
          Çıkış
        </Button>
      </div>

      <main className="flex w-full max-w-[420px] flex-col items-center gap-6 rounded-3xl border bg-card px-6 py-8 shadow-[0_1px_2px_rgb(43_33_27/0.04)] md:px-10 md:py-10">
        <header className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2">
            <BrandMark size={28} />
            <span className="text-sm font-bold text-ink">ShiftUp</span>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Devam takibi</h1>
            <p className="mt-1 text-sm text-ink-secondary">Telefonunuzda ShiftUp → QR Tara ile okutun</p>
          </div>
        </header>

        {error && (
          <Alert tone="danger">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* key: kod her değiştiğinde kutu kısa bir belirme animasyonuyla yeniden çizilir */}
        <div
          key={changeCount}
          className={cn(
            'flex w-full max-w-[280px] justify-center transition-opacity',
            link === 'offline' && 'opacity-35',
            changeCount > 0 && 'animate-in fade-in zoom-in-95 duration-300'
          )}
        >
          <QrCodeDisplay data={qrData ?? ''} size={280} loading={!qrData} />
        </div>

        <div className="flex w-full max-w-[280px] flex-col items-center gap-3">
          {/* İnce bağlantı çubuğu: canlıyken dolu, bağlanırken nabız, koptuğunda soluk kırmızı */}
          <Progress
            aria-label="Bağlantı durumu"
            value={link === 'connecting' ? 40 : 100}
            className={cn('h-1', link === 'connecting' && 'animate-pulse')}
            indicatorClassName={cn(
              link === 'live' && 'bg-success-fill',
              link === 'connecting' && 'bg-ink-muted/40',
              link === 'offline' && 'bg-danger/25'
            )}
          />
          {link === 'live' ? (
            <Badge tone="success">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              Canlı
            </Badge>
          ) : link === 'connecting' ? (
            <Badge tone="neutral">
              <Loader2 className="animate-spin" aria-hidden />
              Bağlanıyor…
            </Badge>
          ) : (
            <Badge tone="danger">
              <WifiOff aria-hidden />
              Bağlantı yok — yeniden deneniyor
            </Badge>
          )}
        </div>

        <p className="max-w-[280px] text-center text-xs leading-relaxed text-ink-muted">
          Kod tek kullanımlıktır; biri okutup onaylandığında otomatik olarak yenisi gelir.
          Okutmak için ShiftUp&apos;a giriş yapmış olmanız gerekir.
        </p>
      </main>
    </div>
  )
}
