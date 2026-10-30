'use client'

/**
 * AttendanceScanPage — QR tara (devam takibi).
 *
 * İki aşamalı akış:
 *   1. Amaç seçimi: çalışanın mevcut durumuna göre uygun işlem düğmeleri gösterilir.
 *      Kullanıcı hangi amaçla QR okutacağını seçer.
 *   2. QR tarama: kiosk ekranındaki QR kodu okutulur. Seçilen amaç ile doğrulama yapılır.
 *
 * Görünüm (telefon öncelikli, ekranı dolduran tek sütun, sade): ortada durum rozeti, büyük saat,
 * bugünkü vardiya ve mola özeti (ayrıntı dokununca açılır); altta (başparmak bölgesinde) tek
 * satırlık işlem düğmeleri. Konum açıklaması (KVKK) tarama kartında, konum istenmeden önce
 * gösterilir. Tarama, konum, kayıt, sonuç ve hata aşamaları aynı yerde tek bir kartta gösterilir.
 *
 * Kurallar:
 *   - Molada iken "Çıkış yap" seçeneği gösterilmez.
 *   - QR onaylandıktan sonra sonuç gösterilir, ardından amaç seçimine geri dönülür.
 *   - Çevrimdışıyken hiçbir işlem başlatılamaz: düğmeler kapalı, kamera açılmaz. Devam kaydı
 *     yalnızca sunucuda (QR + konum) doğrulanır; istemcide kuyruğa alınmaz.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import {
  CalendarOff, CircleAlert, CircleCheck, Clock, LocateFixed, MapPin, MapPinOff, RefreshCw, ScanLine, WifiOff,
} from 'lucide-react'
import type { QrActionType } from '@/types/qr'
import { QR_ACTION_LABELS } from '@/types/qr'
import type { ProcessQrResponse } from '@/types/qr'
import type { GpsCoordinates } from '@/types/location'
import { useAuth } from '@/context/AuthContext'
import { LOADING_LABEL } from '@/components/common/Skeletons'
import { StatusBadge } from '@/components/common/Cards'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { LocationNotice } from '@/components/kvkk/LocationNotice'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { cn } from '@/lib/utils'

import {
  CurrentStatusResponse, PageState, ATTENDANCE_STATUS_TR, STATUS_TONES, getButtons, getCurrentPosition,
  LocationError, PermissionHelp,
} from './scanPageHelpers'
import type { LocationErrorKind } from './scanPageHelpers'
import { useClock } from './useClock'
import { BreakSummary } from './BreakSummary'

// html5-qrcode yalnızca tarayıcıda çalışır; ssr:false ile sunucu paketine (Cloudflare Worker 3 MB sınırı) girmez
const QrScanner = dynamic(() => import('./QrScanner').then((m) => m.QrScanner), { ssr: false })

const OFFLINE_ACTION_MSG = 'İnternet bağlantısı yok. Giriş, çıkış ve mola kayıtları yalnızca çevrimiçiyken yapılabilir.'
const NETWORK_ERROR_MSG = 'Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.'

/** Çevrimdışı uyarısı — işlem düğmelerinin yerine / üstünde gösterilir */
function OfflineActionAlert() {
  return (
    <Alert tone="warning">
      <WifiOff />
      <AlertTitle>Çevrimdışı</AlertTitle>
      <AlertDescription>{OFFLINE_ACTION_MSG}</AlertDescription>
    </Alert>
  )
}

/**
 * Sayfa gövdesi: mobilde üst ve alt bar arasını, masaüstünde başlık altını doldurur; işlem düğmeleri
 * alta (başparmak bölgesine) iner.
 */
const SHELL = cn(
  'mx-auto flex w-full max-w-md flex-col gap-4 p-4 md:py-6',
  'min-h-[calc(100dvh-7rem-var(--app-top)-var(--safe-bottom))] md:min-h-[calc(100dvh-4rem)]'
)

/** Aşama kartı (tarama dışındaki durumlar): kart içinde shadcn Empty */
function StateCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('py-0 shadow-xs', className)}>
      <Empty className="gap-5 p-6 md:p-8">{children}</Empty>
    </Card>
  )
}

/** Oturum / durum yüklenirken: saat bloğu ve işlem düğmesi yer tutucuları */
function ScanPageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label={LOADING_LABEL} className="flex flex-1 flex-col gap-3">
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <Skeleton className="mb-2 h-5 w-20 rounded-full" />
        <Skeleton className="h-12 w-32" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  )
}

// ─── Ana bileşen ─────────────────────────────────────────────

export function AttendanceScanPage() {
  const { employee, status: authStatus } = useAuth()
  const clock = useClock()

  const [pageState, setPageState] = useState<PageState>('loading_status')
  const [statusData, setStatusData] = useState<CurrentStatusResponse | null>(null)
  const hasStatusRef = useRef(false)
  const [selectedAction, setSelectedAction] = useState<QrActionType | null>(null)
  const [scannerActive, setScannerActive] = useState(false)
  const [result, setResult] = useState<ProcessQrResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [locationStatus, setLocationStatus] = useState<string | null>(null)
  const [locationErrorKind, setLocationErrorKind] = useState<LocationErrorKind | null>(null)
  const online = useOnlineStatus()

  // ── Mevcut durumu çek ───────────────────────────────────────
  // silent: durum zaten yüklüyken (keep-alive ile sayfaya geri dönüş) skeleton göstermeden tazele.
  // İşlem sonrası / tekrar dene çağrıları silent değildir — eski düğmelerle yanlış işlem yapılmasın.
  const fetchCurrentStatus = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (silent) setPageState('select_action')
    else setPageState('loading_status')
    setScannerActive(false)
    setErrorMsg(null)
    setLocationErrorKind(null)
    setSelectedAction(null)
    try {
      const res = await fetch('/api/attendance/current-status', {
        credentials: 'same-origin',
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setErrorMsg(data.error ?? 'Durum bilgisi alınamadı.')
        setPageState('error')
        return
      }
      const data = (await res.json()) as CurrentStatusResponse
      setStatusData(data)
      hasStatusRef.current = true
      setPageState('select_action')
    } catch {
      setErrorMsg(NETWORK_ERROR_MSG)
      setPageState('error')
    }
  }, [])

  useEffect(() => {
    if (authStatus === 'authenticated' && employee) {
      void fetchCurrentStatus({ silent: hasStatusRef.current })
    }
  }, [authStatus, employee, fetchCurrentStatus])

  // ── Bağlantı geri geldi → durumu tazele ─────────────────────
  // Çevrimdışıyken gösterilen durum eskimiş olabilir; amaç seçimi / hata ekranındaysak yeniden çek.
  const wasOfflineRef = useRef(false)
  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true
      return
    }
    if (!wasOfflineRef.current) return
    wasOfflineRef.current = false
    if (authStatus !== 'authenticated' || !employee || selectedAction) return
    if (pageState === 'select_action' || pageState === 'error') {
      void fetchCurrentStatus({ silent: pageState === 'select_action' && hasStatusRef.current })
    }
    // Yalnızca bağlantı değişiminde tetiklenir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  // ── Amaç seçildi → tarayıcı ekranına geç ────────────────────
  const handleSelectAction = (action: QrActionType) => {
    if (!navigator.onLine) return
    setSelectedAction(action)
    setScannerActive(true)
    setPageState('scanning')
    setResult(null)
    setErrorMsg(null)
  }

  // ── QR tarandı → GPS al + API çağır ─────────────────────────
  const handleScan = useCallback(
    async (qrData: string) => {
      if (pageState !== 'scanning' || !selectedAction) return
      setScannerActive(false)
      if (!navigator.onLine) {
        setErrorMsg(OFFLINE_ACTION_MSG)
        setPageState('error')
        return
      }
      setPageState('getting_location')
      setLocationStatus('GPS konumu alınıyor...')

      let location: GpsCoordinates | undefined
      try {
        location = await getCurrentPosition()
        setLocationStatus(`Konum alındı (±${Math.round(location.accuracy)}m)`)
      } catch (locErr) {
        setErrorMsg(locErr instanceof Error ? locErr.message : 'Konum alınamadı.')
        setLocationErrorKind(locErr instanceof LocationError ? locErr.kind : 'unknown')
        setLocationStatus(null)
        setPageState('error')
        return
      }

      setPageState('processing')
      setLocationStatus(null)

      try {
        const res = await fetch('/api/qr/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            qr_data: qrData,
            location,
            intended_action: selectedAction,
          }),
        })

        const data = (await res.json()) as ProcessQrResponse & { error?: string }
        if (!res.ok || !data.success) throw new Error(data.error ?? 'İşlem gerçekleştirilemedi.')

        setResult(data)
        setPageState('success')

        // 4 saniye sonra amaç seçimine dön (durumu yenile)
        setTimeout(() => {
          setResult(null)
          void fetchCurrentStatus()
        }, 4000)
      } catch (err) {
        // fetch'in ağ hatası (TypeError) teknik İngilizce mesaj taşır — anlaşılır metinle değiştir
        setErrorMsg(err instanceof TypeError ? NETWORK_ERROR_MSG : err instanceof Error ? err.message : 'Bilinmeyen hata.')
        setPageState('error')
      }
    },
    [pageState, selectedAction, fetchCurrentStatus]
  )

  // ── Geri — tarayıcıdan amaç seçimine dön ────────────────────
  const handleBackToSelect = () => {
    setScannerActive(false)
    setSelectedAction(null)
    setErrorMsg(null)
    setLocationErrorKind(null)
    setLocationStatus(null)
    setPageState('select_action')
  }

  // ── Hata sonrası tekrar dene ─────────────────────────────────
  const handleRetry = () => {
    if (!navigator.onLine) return
    setErrorMsg(null)
    setLocationErrorKind(null)
    setResult(null)
    setLocationStatus(null)
    if (selectedAction) {
      // Amaç zaten seçiliyse tarayıcıya geri dön
      setScannerActive(true)
      setPageState('scanning')
    } else {
      void fetchCurrentStatus()
    }
  }

  // ─── Oturum ──────────────────────────────────────────────────
  if (authStatus === 'loading') {
    return (
      <div className={SHELL}>
        <ScanPageSkeleton />
      </div>
    )
  }

  if (authStatus === 'unauthenticated' || !employee) {
    return (
      <div className="mx-auto w-full max-w-md p-4 md:py-6">
        {/* Çevrimdışı açılışta oturum doğrulanamaz; bağlantı gelince oturum yeniden sorgulanır */}
        {!online ? <OfflineActionAlert /> : (
          <Alert tone="warning">
            <CircleAlert />
            <AlertTitle>Giriş gerekli</AlertTitle>
            <AlertDescription>Devam takibi için sisteme giriş yapmanız gerekiyor.</AlertDescription>
          </Alert>
        )}
      </div>
    )
  }

  // ─── Yardımcı değerler ───────────────────────────────────────
  const currentStatus = statusData?.current_status ?? null
  const statusTone = STATUS_TONES[currentStatus ?? ''] ?? 'neutral'
  const statusLabel = ATTENDANCE_STATUS_TR[currentStatus ?? ''] ?? '—'
  const buttons = getButtons(currentStatus)
  const hasShift = statusData?.has_shift ?? false

  const isLocationError =
    !!locationErrorKind ||
    (!!errorMsg &&
      (errorMsg.toLowerCase().includes('konum') ||
        errorMsg.toLowerCase().includes('gps') ||
        errorMsg.toLowerCase().includes('izin')))
  // Ayar yönlendirmesi yalnızca izin reddinde; zaman aşımı / sinyal yokken "tekrar dene" yeterli
  const showLocationPermissionHelp =
    locationErrorKind === 'denied' ||
    (!locationErrorKind && isLocationError && !!errorMsg && errorMsg.toLowerCase().includes('izin'))
  const isLocationRetryable = locationErrorKind === 'timeout' || locationErrorKind === 'unavailable'

  const scanning = pageState === 'scanning'
  const shiftText = hasShift && statusData?.shift_start
    ? `${statusData.shift_start.slice(0, 5)}–${statusData.shift_end?.slice(0, 5) ?? ''}`
    : null

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div className={SHELL}>
      {/* Mobilde başlık üst barda; burada yalnızca ekran okuyucular için */}
      <header className="max-md:sr-only">
        <h1 className="text-2xl font-semibold tracking-tight">{scanning ? 'QR kodu okutun' : 'QR tara'}</h1>
        <p className="text-sm text-muted-foreground">Kiosk ekranındaki kodu okutarak giriş, mola ve çıkış yapın</p>
      </header>

      {/* ── DURUM YÜKLENİYOR ── */}
      {pageState === 'loading_status' && <ScanPageSkeleton />}

      {/* ── AMAÇ SEÇİMİ ── */}
      {pageState === 'select_action' && (
        <>
          {/* Durum, saat, bugünkü vardiya ve molalar — tek blok; mola ayrıntısı dokununca açılır */}
          <section aria-label="Şu an" className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
            {/* Vardiya bitince aşağıdaki "Vardiya tamamlandı" kartı yeterli */}
            {currentStatus && currentStatus !== 'clocked_out' && (
              <StatusBadge tone={statusTone} label={statusLabel} className="mb-2" />
            )}
            <p className="text-5xl font-semibold tracking-tight tabular-nums" suppressHydrationWarning>
              {clock?.time ?? '—'}
            </p>
            <p className="text-sm text-muted-foreground first-letter:uppercase">{clock?.date ?? ''}</p>
            {shiftText && (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <p className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm tabular-nums">
                  <Clock className="size-3.5 text-muted-foreground" aria-hidden />
                  Vardiya {shiftText}
                </p>
                <BreakSummary breaks={statusData?.breaks ?? []} />
              </div>
            )}
          </section>

          {!hasShift && (
            <StateCard>
              <EmptyHeader>
                <EmptyMedia variant="icon"><CalendarOff /></EmptyMedia>
                <EmptyTitle>Bugün vardiyanız yok</EmptyTitle>
                <EmptyDescription>Bugün için tanımlı vardiya yok. Plan değiştiyse yöneticinize danışın.</EmptyDescription>
              </EmptyHeader>
            </StateCard>
          )}

          {hasShift && currentStatus === 'clocked_out' && (
            <StateCard>
              <EmptyHeader>
                <EmptyMedia variant="icon" className="bg-success/10 text-success"><CircleCheck /></EmptyMedia>
                <EmptyTitle>Vardiya tamamlandı</EmptyTitle>
                <EmptyDescription>Bugünkü vardiyanız başarıyla tamamlandı. İyi dinlenmeler!</EmptyDescription>
              </EmptyHeader>
            </StateCard>
          )}

          {hasShift && buttons.length > 0 && (
            <section aria-labelledby="scan-actions-title" className="flex flex-col gap-3">
              <h2 id="scan-actions-title" className="sr-only">Ne yapmak istiyorsunuz?</h2>

              {!online && <OfflineActionAlert />}

              {/* Molada yalnızca "Moladan dön" çıkar (çıkış kuralı ayrıca yazılmaz); konum açıklaması tarama ekranında */}
              {buttons.map((btn) => {
                const Icon = btn.icon
                const primary = btn.primary
                return (
                  <Button
                    key={btn.action}
                    type="button"
                    variant={primary ? 'default' : 'outline'}
                    disabled={!online}
                    onClick={() => handleSelectAction(btn.action)}
                    className={cn(
                      'w-full justify-start gap-3 rounded-xl px-5 has-[>svg]:px-5 [&_svg:not([class*=size-])]:size-5',
                      primary ? 'h-16 text-lg font-semibold' : 'h-12 text-base'
                    )}
                  >
                    <Icon aria-hidden />
                    <span className="flex-1 text-left">{btn.label}</span>
                    <ScanLine aria-hidden className="opacity-70" />
                  </Button>
                )
              })}
            </section>
          )}
        </>
      )}

      {/* ── QR TARAYICI ── */}
      {scanning && (
        <Card className="gap-4 py-4 shadow-xs">
          <CardHeader className="px-4">
            <CardTitle>{selectedAction ? QR_ACTION_LABELS[selectedAction] : 'QR tara'}</CardTitle>
            <CardDescription>Kiosk ekranındaki QR kodu çerçeveye hizalayın</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4 px-4">
            {/* Çevrimdışıyken kamera hiç açılmaz; bağlantı gelince tarayıcı kendiliğinden başlar */}
            {online ? (
              <QrScanner onScan={(data) => void handleScan(data)} onError={(e) => setErrorMsg(e)} active={scannerActive} />
            ) : (
              <OfflineActionAlert />
            )}

            {online && errorMsg && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            <LocationNotice />
            <Button variant="outline" onClick={handleBackToSelect} className="w-full">
              Vazgeç
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── GPS ALINIYOR ── */}
      {pageState === 'getting_location' && (
        <StateCard className="my-auto">
          <EmptyHeader>
            <EmptyMedia variant="icon"><LocateFixed /></EmptyMedia>
            <EmptyTitle className="flex items-center gap-2"><Spinner />Konum alınıyor</EmptyTitle>
            <EmptyDescription>{locationStatus ?? 'Lütfen bekleyin…'}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <p className="text-xs text-muted-foreground">
              Konum izni penceresi açılırsa <strong className="font-medium text-foreground">“İzin Ver”</strong> seçin
            </p>
          </EmptyContent>
        </StateCard>
      )}

      {/* ── İŞLENİYOR ── */}
      {pageState === 'processing' && (
        <StateCard className="my-auto">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Spinner className="size-6" /></EmptyMedia>
            <EmptyTitle>Kaydediliyor…</EmptyTitle>
            <EmptyDescription>QR kodu ve konumunuz doğrulanıyor.</EmptyDescription>
          </EmptyHeader>
        </StateCard>
      )}

      {/* ── BAŞARILI ── */}
      {pageState === 'success' && result && (
        <StateCard className="my-auto">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="size-14 rounded-full bg-success/10 text-success [&_svg:not([class*='size-'])]:size-7">
              <CircleCheck />
            </EmptyMedia>
            <EmptyTitle>{result.message}</EmptyTitle>
            <EmptyDescription className="flex items-center justify-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden />
              {QR_ACTION_LABELS[result.action_type]} — {result.timestamp}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <StatusBadge
              tone={STATUS_TONES[result.new_status] ?? 'neutral'}
              label={ATTENDANCE_STATUS_TR[result.new_status] ?? result.new_status}
            />
          </EmptyContent>
        </StateCard>
      )}

      {/* ── HATA ── */}
      {pageState === 'error' && (
        <StateCard className="my-auto">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
              {isLocationError ? <MapPinOff /> : <CircleAlert />}
            </EmptyMedia>
            <EmptyTitle className="whitespace-pre-line">{errorMsg ?? 'İşlem başarısız.'}</EmptyTitle>
            {isLocationRetryable && (
              <EmptyDescription>
                Konum servislerinin açık olduğundan emin olun; açık alanda veya pencere kenarında tekrar deneyin.
                QR kodunu yeniden okutmanız gerekir.
              </EmptyDescription>
            )}
          </EmptyHeader>
          <EmptyContent className="max-w-md gap-3">
            {showLocationPermissionHelp && <PermissionHelp kind="location" />}
            {!online && <OfflineActionAlert />}
            <div className="grid w-full grid-cols-2 gap-2">
              <Button variant="outline" onClick={handleBackToSelect}>
                Geri
              </Button>
              <Button onClick={handleRetry} disabled={!online}>
                <RefreshCw /> {isLocationError ? 'Tekrar tara' : 'Tekrar dene'}
              </Button>
            </div>
          </EmptyContent>
        </StateCard>
      )}
    </div>
  )
}
