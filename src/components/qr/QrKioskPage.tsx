'use client'

/**
 * QrKioskPage — Tek kullanımlık kiosk QR'ı, Supabase Realtime Broadcast ile güncellenir.
 *
 * - Ekran aktif mağazanın private "kiosk-qr:<store_id>" kanalına hemen abone olur (mağaza
 *   oturumdan bilinir; bilinmiyorsa kanal adı GET /api/kiosk/qr yanıtından alınır) (kiosk / yönetici / müdür yalnızca kendi
 *   mağazasının, admin her mağazanın kanalına; yetki realtime.messages RLS politikasıyla
 *   veritabanında denetlenir).
 * - Abonelik kurulunca (ilk açılış ve her yeniden bağlanma) güncel kod yine bir kez alınır.
 *   Sonrasında kod yalnızca biri okutup onaylandığında, sunucunun yayınıyla değişir.
 * - Zamanlayıcı / periyodik istek yoktur.
 * - Tarayıcı çevrimdışıyken bağlantı geri gelince (online olayı) güncel kod yine bir kez alınır.
 * - Sayfa görünürken ekran kilidi (Screen Wake Lock) istenir; destek yoksa sessizce atlanır.
 *   "Tam ekran" butonu yalnızca Fullscreen API destekleniyorsa ve zaten tam ekran / kurulu
 *   uygulama değilse görünür.
 *
 * Görünüm: kabuksuz tam ekran (güvenli alan dolgusu kendinde). Üstte marka + mağaza adı ve eylemler;
 * geniş ekranda solda canlı saat ve adımlar, sağda büyük QR kartı (bağlantı durumu rozetiyle);
 * telefonda alt alta.
 */
import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'
import { CircleAlert, LayoutDashboard, LogOut, Maximize, WifiOff } from 'lucide-react'
import { QrCodeDisplay } from './QrCodeDisplay'
import { useClock } from './useClock'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { BrandMark } from '@/components/common/BrandMark'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { isKioskRole } from '@/lib/auth/roles'
import { getSupabaseBrowserClient } from '@/lib/supabase/browser'
import { isStandaloneDisplay } from '@/lib/pwa/deviceInfo'

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
  const { employee, store, signOut } = useAuth()
  const storeId = store?.active.id ?? null
  const isKiosk = isKioskRole(employee?.roles?.access_level ?? null)

  const [qrData, setQrData] = useState<string | null>(null)
  const [link, setLink] = useState<LinkState>('connecting')
  const [error, setError] = useState<string | null>(null)
  /** Kod her değiştiğinde artar → QR kutusu kısa bir vurgu animasyonuyla yeniden çizilir */
  const [changeCount, setChangeCount] = useState(0)

  /** Her yayında artar: yayından eski bir GET yanıtı yeni kodun üzerine yazmasın */
  const versionRef = useRef(0)

  useScreenWakeLock()
  const canEnterFullscreen = useCanEnterFullscreen()
  const clock = useClock()

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    let disposed = false

    const showQr = (data: string) => {
      setQrData((prev) => {
        if (prev && prev !== data) setChangeCount((n) => n + 1)
        return data
      })
    }

    /** Abone olunan mağaza kanalı; API'nin döndürdüğü kanal değişirse (ör. admin mağaza değiştirdi) yeniden abone olunur */
    let channel: RealtimeChannel | null = null
    let topic: string | null = null
    let authReady = false

    const subscribeTo = (nextTopic: string) => {
      if (disposed || !authReady || nextTopic === topic) return
      if (channel) void supabase.removeChannel(channel)
      topic = nextTopic
      channel = supabase.channel(nextTopic, { config: { private: true } })
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
        const { qr_data, topic: apiTopic } = (await res.json()) as { qr_data: string; topic: string }
        if (!disposed && versionRef.current === startedAt) showQr(qr_data)
        setError(null)
        // Kanal adı sunucudan gelir (mağaza başına); henüz abone değilsek / kanal değiştiyse abone ol
        if (typeof apiTopic === 'string') subscribeTo(apiTopic)
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : 'QR kodu alınamadı.')
      }
    }

    const start = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (disposed) return
      if (!session) {
        setLink('offline')
        setError('Gerçek zamanlı bağlantı için oturum bulunamadı. Çıkış yapıp yeniden giriş yapın.')
        return
      }
      await supabase.realtime.setAuth(session.access_token)
      authReady = true
      // Mağaza oturumdan biliniyorsa ilk istek beklenmeden abone olunur (ilk istek başarısız olsa
      // da kanal kurulur; SUBSCRIBED olunca güncel kod alınır). Bilinmiyorsa kanal adı API'den gelir.
      if (storeId) subscribeTo(`kiosk-qr:${storeId}`)
      else await fetchCurrent()
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
      if (channel) void supabase.removeChannel(channel)
    }
  }, [router, storeId])

  const linkBadge = link === 'live' ? (
    <Badge tone="success">Canlı</Badge>
  ) : link === 'connecting' ? (
    <Badge variant="outline">
      <Spinner className="size-3" aria-hidden />
      Bağlanıyor…
    </Badge>
  ) : (
    <Badge variant="outline" className="text-destructive">
      <WifiOff aria-hidden />
      Bağlantı yok — yeniden deneniyor
    </Badge>
  )

  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col bg-muted/40',
        // Kabuksuz tam ekran: iOS çentik / ana ekran çubuğu için güvenli alan kendi dolgumuzda
        'pt-[max(1rem,var(--app-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,var(--safe-bottom))] pl-[max(1rem,env(safe-area-inset-left))]',
        'md:pt-[max(1.5rem,var(--app-top))] md:pr-[max(2rem,env(safe-area-inset-right))] md:pb-[max(1.5rem,var(--safe-bottom))] md:pl-[max(2rem,env(safe-area-inset-left))]'
      )}
    >
      {/* Üst çubuk: marka + mağaza, sağda eylemler */}
      <header className="flex items-center gap-3">
        <BrandMark size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">ShiftUp</p>
          <p className="truncate text-sm text-muted-foreground">{store?.active.name ?? 'QR kiosk'}</p>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {canEnterFullscreen && (
            <Button variant="ghost" size="sm" onClick={enterFullscreen} aria-label="Tam ekran">
              <Maximize />
              <span className="max-sm:sr-only">Tam ekran</span>
            </Button>
          )}
          {!isKiosk && (
            <Button variant="ghost" size="sm" onClick={() => router.push('/')} aria-label="Panele dön">
              <LayoutDashboard />
              <span className="max-sm:sr-only">Panele dön</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void signOut()} aria-label="Çıkış">
            <LogOut />
            <span className="max-sm:sr-only">Çıkış</span>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center py-6 md:py-10">
        <div className="grid w-full max-w-5xl items-center gap-6 md:gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
          {/* Saat + yönerge */}
          <section className="flex flex-col items-center gap-1 text-center lg:items-start lg:text-left">
            <p className="text-sm text-muted-foreground first-letter:uppercase" suppressHydrationWarning>
              {clock?.date ?? ' '}
            </p>
            <p className="text-6xl font-semibold tracking-tight tabular-nums lg:text-8xl" suppressHydrationWarning>
              {clock?.time ?? '—'}
            </p>
            <h1 className="mt-4 text-xl font-semibold tracking-tight md:text-2xl lg:mt-8">
              Giriş, mola ve çıkış için QR&apos;ı okutun
            </h1>
            <ol className="mt-4 hidden flex-col gap-3 text-left md:flex">
              {[
                'Telefonunuzda ShiftUp\'ı açın',
                'QR tara\'ya dokunup işleminizi seçin',
                'Kamerayı bu ekrandaki koda tutun',
              ].map((step, i) => (
                <li key={step} className="flex items-center gap-3 text-muted-foreground">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-medium text-foreground tabular-nums">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="text-sm text-muted-foreground md:hidden">Telefonunuzda ShiftUp → QR tara ile okutun</p>
          </section>

          {/* QR kartı */}
          <Card className="mx-auto w-full max-w-sm gap-5 py-5 shadow-xs md:max-w-md md:py-6">
            <CardContent className="flex flex-col items-center gap-5 px-5 md:px-6">
              {error && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertTitle>QR kodu alınamadı</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* key: kod her değiştiğinde kutu kısa bir belirme animasyonuyla yeniden çizilir */}
              <div
                key={changeCount}
                className={cn(
                  'flex w-full justify-center transition-opacity',
                  link === 'offline' && qrData && 'opacity-35',
                  changeCount > 0 && 'animate-in fade-in zoom-in-95 duration-300'
                )}
              >
                {qrData ? (
                  <QrCodeDisplay data={qrData} size={360} />
                ) : (
                  // İlk kod gelene kadar: bağlantı durumuna göre bekleme kutusu
                  <div
                    role="img"
                    aria-label="QR kod oluşturuluyor"
                    className="flex aspect-square w-full max-w-90 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-muted/50 p-6 text-center"
                  >
                    {link === 'offline' ? <WifiOff className="size-6 text-muted-foreground" aria-hidden /> : <Spinner className="size-6 text-muted-foreground" />}
                    <p className="text-sm font-medium">{link === 'offline' ? 'Bağlantı bekleniyor' : 'Kod hazırlanıyor…'}</p>
                    <p className="max-w-56 text-xs text-muted-foreground">
                      {link === 'offline' ? 'Bağlantı kurulunca QR kodu burada görünecek.' : 'Birkaç saniye içinde QR kodu görünecek.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex w-full items-center justify-between gap-3">
                <span className="text-sm font-medium">Bağlantı</span>
                {linkBadge}
              </div>
            </CardContent>
            <CardFooter className="border-t px-5 text-sm text-muted-foreground md:px-6 [.border-t]:pt-5">
              Kod tek kullanımlıktır; biri okutup onaylandığında otomatik olarak yenisi gelir.
              Okutmak için ShiftUp&apos;a giriş yapmış olmanız gerekir.
            </CardFooter>
          </Card>
        </div>
      </main>
    </div>
  )
}
