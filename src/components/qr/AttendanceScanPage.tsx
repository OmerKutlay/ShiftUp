'use client'

/**
 * AttendanceScanPage — Devam Takibi
 *
 * İki aşamalı akış:
 *   1. Amaç Seçimi: Çalışanın mevcut durumuna göre uygun aksiyon butonları gösterilir.
 *      Kullanıcı hangi amaçla QR okutacağını seçer.
 *   2. QR Tarama: Kiosk ekranındaki QR kodu okutulur. Seçilen amaç ile doğrulama yapılır.
 *
 * Kurallar:
 *   - Molada iken "Çıkış Yap" seçeneği gösterilmez.
 *   - QR onaylandıktan sonra sonuç gösterilir, ardından amaç seçimine geri dönülür.
 *   - Çevrimdışıyken hiçbir işlem başlatılamaz: butonlar kapalı, kamera açılmaz. Devam kaydı
 *     yalnızca sunucuda (QR + konum) doğrulanır; istemcide kuyruğa alınmaz.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import {
  AlertCircle, CheckCircle2, ChevronLeft, Clock, Loader2, LocateFixed, MapPin, MapPinOff, RefreshCw, ScanLine, WifiOff,
} from 'lucide-react'
import type { QrActionType } from '@/types/qr'
import { QR_ACTION_LABELS } from '@/types/qr'
import type { ProcessQrResponse } from '@/types/qr'
import type { GpsCoordinates } from '@/types/location'
import { useAuth } from '@/context/AuthContext'
import { LOADING_LABEL } from '@/components/common/Skeletons'
import { PersonAvatar } from '@/components/common/PersonAvatar'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { cn } from '@/lib/utils'

import {
  CurrentStatusResponse, PageState, ATTENDANCE_STATUS_TR, STATUS_TONES, getButtons, getCurrentPosition,
  LocationError, PermissionHelp,
} from './scanPageHelpers'
import type { ActionButton, LocationErrorKind } from './scanPageHelpers'

// html5-qrcode yalnızca tarayıcıda çalışır; ssr:false ile sunucu paketine (Cloudflare Worker 3 MB sınırı) girmez
const QrScanner = dynamic(() => import('./QrScanner').then((m) => m.QrScanner), { ssr: false })

const OFFLINE_ACTION_MSG = 'İnternet bağlantısı yok. Giriş, çıkış ve mola kayıtları yalnızca çevrimiçiyken yapılabilir.'
const NETWORK_ERROR_MSG = 'Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.'

/** Çevrimdışı uyarısı — işlem butonlarının yerine / üstünde gösterilir */
function OfflineActionAlert() {
  return (
    <Alert tone="warning">
      <WifiOff />
      <AlertDescription className="text-ink">{OFFLINE_ACTION_MSG}</AlertDescription>
    </Alert>
  )
}

/** Aksiyon tonuna göre ikon zemini / rengi */
const ACTION_TONE: Record<ActionButton['tone'], string> = {
  brand: 'bg-brand-soft text-brand',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
}

/** Durum ekranlarındaki büyük yuvarlak ikon */
function StateIcon({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn('flex size-20 items-center justify-center rounded-full [&_svg]:size-9', className)}>{children}</span>
  )
}

// ─── Ana Component ────────────────────────────────────────────

export function AttendanceScanPage() {
  const { employee, status: authStatus } = useAuth()

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
  // İşlem sonrası / tekrar dene çağrıları silent değildir — eski butonlarla yanlış işlem yapılmasın.
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

  // ── Amaç seçildi → scanner ekranına geç ─────────────────────
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

  // ── Geri — scanner'dan amaç seçimine dön ────────────────────
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
      // Amaç zaten seçiliyse scanner'a geri dön
      setScannerActive(true)
      setPageState('scanning')
    } else {
      void fetchCurrentStatus()
    }
  }

  // ─── Auth guard ──────────────────────────────────────────────
  if (authStatus === 'loading') {
    return (
      <div className="flex justify-center p-4 md:p-8">
        <div role="status" aria-busy="true" aria-label={LOADING_LABEL} className="flex w-full max-w-md flex-col gap-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  if (authStatus === 'unauthenticated' || !employee) {
    return (
      <div className="mx-auto w-full max-w-md p-4 md:p-8">
        {/* Çevrimdışı açılışta oturum doğrulanamaz; bağlantı gelince oturum yeniden sorgulanır */}
        {!online ? <OfflineActionAlert /> : (
          <Alert tone="warning">
            <AlertCircle />
            <AlertDescription className="text-ink">Devam takibi için sisteme giriş yapmanız gerekiyor.</AlertDescription>
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

  // ─── Render ──────────────────────────────────────────────────
  const scanning = pageState === 'scanning'
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 md:py-8">
      {/* Başlık */}
      <header className="flex items-center gap-2">
        {scanning && (
          <Button variant="ghost" size="icon-sm" onClick={handleBackToSelect} aria-label="Geri" className="-ml-2">
            <ChevronLeft className="size-5" />
          </Button>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-secondary">{scanning ? 'Kiosk ekranındaki kodu okutun' : 'QR tara'}</p>
          <h1 className="text-[1.6rem] font-bold leading-tight tracking-tight md:text-[1.85rem]">
            {scanning ? 'QR kodu okutun' : 'Devam takibi'}
          </h1>
        </div>
      </header>

      {/* Kişi + mevcut durum */}
      <section className="flex items-center gap-3 rounded-2xl border bg-card p-3.5">
        <PersonAvatar name={employee.full_name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{employee.full_name}</p>
          <p className="flex items-center gap-1 truncate text-xs text-ink-secondary">
            {hasShift && statusData?.shift_start ? (
              <>
                <Clock className="size-3.5" />
                Vardiya {statusData.shift_start.slice(0, 5)} – {statusData.shift_end?.slice(0, 5)}
              </>
            ) : (
              employee.roles?.name
            )}
          </p>
        </div>
        {currentStatus && !scanning && <Badge tone={statusTone}>{statusLabel}</Badge>}
      </section>

      {/* ── DURUM YÜKLENİYOR ── */}
      {pageState === 'loading_status' && (
        <div role="status" aria-busy="true" aria-label={LOADING_LABEL} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      )}

      {/* ── AMAÇ SEÇİMİ ── */}
      {pageState === 'select_action' && (
        <section className="flex flex-col gap-3">
          {!online && hasShift && buttons.length > 0 && <OfflineActionAlert />}

          {!hasShift && (
            <Alert tone="info">
              <AlertCircle />
              <AlertDescription className="text-ink">Bugün için tanımlı vardiya yok.</AlertDescription>
            </Alert>
          )}

          {hasShift && currentStatus === 'clocked_out' && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-6 py-8 text-center">
              <StateIcon className="bg-plum-soft text-plum"><CheckCircle2 /></StateIcon>
              <p className="mt-1 font-bold">Vardiya tamamlandı</p>
              <p className="text-sm text-ink-secondary">Bugünkü vardiyanız başarıyla tamamlandı. İyi çalışmalar!</p>
            </div>
          )}

          {hasShift && currentStatus === 'on_break' && (
            <Alert tone="warning">
              <Clock />
              <AlertDescription className="text-ink">Molada iken çıkış yapılamaz. Önce moladan dönün.</AlertDescription>
            </Alert>
          )}

          {hasShift && buttons.length > 0 && (
            <>
              <p className="px-1 pt-1 text-sm font-semibold text-ink-secondary">Ne yapmak istiyorsunuz?</p>
              {buttons.map((btn) => {
                const Icon = btn.icon
                return (
                  <button
                    key={btn.action}
                    type="button"
                    disabled={!online}
                    onClick={() => handleSelectAction(btn.action)}
                    className="group flex w-full items-center gap-4 rounded-2xl border bg-card p-4 text-left transition-[border-color,box-shadow] outline-none hover:border-sand focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-xl', ACTION_TONE[btn.tone])}>
                      <Icon className="size-6" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{btn.label}</span>
                      <span className="block text-sm text-ink-secondary">{btn.description}</span>
                    </span>
                    <ScanLine className="size-5 text-ink-muted transition-colors group-hover:text-primary" />
                  </button>
                )
              })}
            </>
          )}
        </section>
      )}

      {/* ── QR TARAYICI ── */}
      {scanning && (
        <section className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-4">
          {selectedAction && <Badge tone="brand" className="h-7 px-3 text-sm">{QR_ACTION_LABELS[selectedAction]}</Badge>}

          {/* Çevrimdışıyken kamera hiç açılmaz; bağlantı gelince tarayıcı kendiliğinden başlar */}
          {online ? (
            <QrScanner onScan={(data) => void handleScan(data)} onError={(e) => setErrorMsg(e)} active={scannerActive} />
          ) : (
            <OfflineActionAlert />
          )}

          {online && errorMsg && (
            <Alert tone="danger">
              <AlertCircle />
              <AlertDescription className="text-ink">{errorMsg}</AlertDescription>
            </Alert>
          )}

          <p className="flex items-center gap-1.5 text-xs text-ink-secondary">
            <MapPin className="size-3.5 text-primary" />
            QR tarandıktan sonra konum doğrulaması yapılır
          </p>
          <Button variant="ghost" size="sm" onClick={handleBackToSelect} className="text-ink-secondary">
            <ChevronLeft /> Amacı değiştir
          </Button>
        </section>
      )}

      {/* ── GPS ALINIYOR ── */}
      {pageState === 'getting_location' && (
        <section className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-6 py-8 text-center">
          <StateIcon className="relative bg-brand-soft text-primary">
            <LocateFixed />
            <Loader2 aria-hidden className="absolute inset-0 !size-20 animate-spin text-primary/40" strokeWidth={1} />
          </StateIcon>
          <p className="mt-2 font-bold">Konum alınıyor</p>
          <p className="text-sm text-ink-secondary">{locationStatus ?? 'Lütfen bekleyin…'}</p>
          <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-xs text-ink-secondary">
            Konum izni penceresi açılırsa <strong className="text-ink">“İzin Ver”</strong> seçin
          </p>
        </section>
      )}

      {/* ── İŞLENİYOR ── */}
      {pageState === 'processing' && (
        <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-6 py-10">
          <Loader2 className="size-10 animate-spin text-primary" />
          <p className="font-semibold">Kaydediliyor…</p>
        </section>
      )}

      {/* ── BAŞARILI ── */}
      {pageState === 'success' && result && (
        <section className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-6 py-8 text-center">
          <StateIcon className="bg-success-soft text-success"><CheckCircle2 /></StateIcon>
          <p className="mt-2 text-lg font-bold text-success">{result.message}</p>
          <Badge tone={STATUS_TONES[result.new_status] ?? 'neutral'} className="h-7 px-3 text-sm">
            {ATTENDANCE_STATUS_TR[result.new_status] ?? result.new_status}
          </Badge>
          <p className="flex items-center gap-1 text-xs text-ink-secondary">
            <MapPin className="size-3.5 text-success" />
            {QR_ACTION_LABELS[result.action_type]} — {result.timestamp}
          </p>
        </section>
      )}

      {/* ── HATA ── */}
      {pageState === 'error' && (
        <section className="flex flex-col items-center gap-3 rounded-2xl border bg-card px-5 py-7 text-center">
          <StateIcon className="bg-danger-soft text-danger">{isLocationError ? <MapPinOff /> : <AlertCircle />}</StateIcon>
          <p className="whitespace-pre-line font-bold text-danger">{errorMsg ?? 'İşlem başarısız.'}</p>

          {showLocationPermissionHelp && <PermissionHelp kind="location" />}

          {isLocationRetryable && (
            <p className="text-xs text-ink-secondary">
              Konum servislerinin açık olduğundan emin olun; açık alanda veya pencere kenarında tekrar deneyin.
              QR kodunu yeniden okutmanız gerekir.
            </p>
          )}

          {!online && <OfflineActionAlert />}

          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Button onClick={handleRetry} disabled={!online}>
              <RefreshCw /> {isLocationError ? 'Tekrar Tara' : 'Tekrar Dene'}
            </Button>
            <Button variant="ghost" onClick={handleBackToSelect} className="text-ink-secondary">
              <ChevronLeft /> Geri
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
