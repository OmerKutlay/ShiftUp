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
  Box,
  Typography,
  Paper,
  CircularProgress,
  Chip,
  Divider,
  Stack,
  Alert,
  Button,
  IconButton,
  Skeleton,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import PersonIcon from '@mui/icons-material/Person'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import RefreshIcon from '@mui/icons-material/Refresh'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import LocationOffIcon from '@mui/icons-material/LocationOff'
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner'
import WifiOffIcon from '@mui/icons-material/WifiOff'
import type { QrActionType } from '@/types/qr'
import { QR_ACTION_LABELS } from '@/types/qr'
import type { ProcessQrResponse } from '@/types/qr'
import type { GpsCoordinates } from '@/types/location'
import { useAuth } from '@/context/AuthContext'
import { LOADING_LABEL } from '@/components/common'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

import {
  CurrentStatusResponse, PageState, ATTENDANCE_STATUS_TR, STATUS_COLORS, STATUS_BG_COLORS, getButtons, getCurrentPosition,
  LocationError, PermissionHelp,
} from './scanPageHelpers'
import type { LocationErrorKind } from './scanPageHelpers'
import { C, tint } from '@/lib/palette'

// html5-qrcode yalnızca tarayıcıda çalışır; ssr:false ile sunucu paketine (Cloudflare Worker 3 MB sınırı) girmez
const QrScanner = dynamic(() => import('./QrScanner').then((m) => m.QrScanner), { ssr: false })

const OFFLINE_ACTION_MSG = 'İnternet bağlantısı yok. Giriş, çıkış ve mola kayıtları yalnızca çevrimiçiyken yapılabilir.'
const NETWORK_ERROR_MSG = 'Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.'

/** Çevrimdışı uyarısı — işlem butonlarının yerine / üstünde gösterilir */
function OfflineActionAlert() {
  return (
    <Alert severity="warning" icon={<WifiOffIcon />} sx={{ width: '100%', borderRadius: 1.5 }}>
      {OFFLINE_ACTION_MSG}
    </Alert>
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
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 2, md: 4 },
        }}
      >
        <Box
          role="status"
          aria-busy="true"
          aria-label={LOADING_LABEL}
          sx={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}
        >
          <Skeleton variant="text" width={90} sx={{ fontSize: '0.75rem' }} />
          <Skeleton variant="text" width={200} sx={{ fontSize: '1.5rem', mb: 2 }} />
          <Skeleton variant="rounded" width="100%" height={120} sx={{ borderRadius: 3 }} />
          <Skeleton variant="rounded" width="100%" height={52} sx={{ borderRadius: 2, mt: 1 }} />
          <Skeleton variant="rounded" width="100%" height={52} sx={{ borderRadius: 2 }} />
        </Box>
      </Box>
    )
  }

  if (authStatus === 'unauthenticated' || !employee) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
        }}
      >
        {/* Çevrimdışı açılışta oturum doğrulanamaz; bağlantı gelince oturum yeniden sorgulanır */}
        {!online ? <OfflineActionAlert /> : (
          <Alert severity="warning">Devam takibi için sisteme giriş yapmanız gerekiyor.</Alert>
        )}
      </Box>
    )
  }

  // ─── Yardımcı değerler ───────────────────────────────────────
  const currentStatus = statusData?.current_status ?? null
  const statusColor = STATUS_COLORS[currentStatus ?? ''] ?? C.inkMuted
  const statusBg = STATUS_BG_COLORS[currentStatus ?? ''] ?? tint(C.neutral, 0.08)
  const statusLabel = ATTENDANCE_STATUS_TR[currentStatus ?? ''] ?? '—'
  const buttons = getButtons(currentStatus)
  const hasShift = statusData?.has_shift ?? false
  const resultStatusColor = result ? (STATUS_COLORS[result.new_status] ?? C.inkMuted) : C.inkMuted

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
  return (
    <Box
      sx={{
        color: 'text.primary',
        p: { xs: 2, md: 4 },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Header */}
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={0.5}>
          QR Tara
        </Typography>
        <Typography variant="h5" fontWeight={800}>
          {pageState === 'scanning' ? 'QR Kodu Okutun' : 'Devam Takibi'}
        </Typography>
        {pageState === 'scanning' && selectedAction && (
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Amaç:{' '}
            <Box component="span" fontWeight={700} color="primary.main">
              {QR_ACTION_LABELS[selectedAction]}
            </Box>
          </Typography>
        )}
        {pageState === 'select_action' && (
          <Typography variant="body2" color="text.secondary" mt={0.5}>
            Ne yapmak istediğinizi seçin, ardından QR okutun
          </Typography>
        )}
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 3 },
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 3,
          bgcolor: 'background.paper',
          width: '100%',
          maxWidth: 440,
        }}
      >
        {/* Çalışan bilgisi + geri butonu */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            mb: 3,
            p: 1.5,
            bgcolor: tint(C.brand, 0.06),
            borderRadius: 1.5,
            border: `1px solid ${tint(C.brand, 0.15)}`,
          }}
        >
          {(pageState === 'scanning') && (
            <IconButton
              size="small"
              onClick={handleBackToSelect}
              aria-label="Geri"
              sx={{ color: 'primary.main', ml: -0.5, mr: 0.25 }}
            >
              <ChevronLeftIcon />
            </IconButton>
          )}
          <PersonIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={700} color="text.primary">
              {employee.full_name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {employee.roles?.name}
            </Typography>
          </Box>
          {/* Mevcut durum chip — scanning dışı ekranlarda */}
          {currentStatus && currentStatus !== 'clocked_out' && pageState !== 'scanning' && (
            <Chip
              label={statusLabel}
              size="small"
              sx={{
                bgcolor: `${statusColor}20`,
                color: statusColor,
                border: '1px solid',
                borderColor: `${statusColor}40`,
                fontWeight: 600,
                fontSize: '0.7rem',
              }}
            />
          )}
        </Box>

        <Divider sx={{ mb: 3, borderColor: tint(C.ink, 0.08) }} />

        <Stack spacing={2.5} alignItems="center">

          {/* ── DURUM YÜKLENİYOR ── */}
          {pageState === 'loading_status' && (
            <Box
              role="status"
              aria-busy="true"
              aria-label={LOADING_LABEL}
              sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}
            >
              <Skeleton variant="rounded" height={88} sx={{ borderRadius: 2 }} />
              <Skeleton variant="text" width={140} sx={{ mt: 1 }} />
              <Skeleton variant="rounded" height={52} sx={{ borderRadius: 2 }} />
              <Skeleton variant="rounded" height={52} sx={{ borderRadius: 2 }} />
            </Box>
          )}

          {/* ── AMAÇ SEÇİMİ ── */}
          {pageState === 'select_action' && (
            <Box sx={{ width: '100%' }}>
              {!online && hasShift && buttons.length > 0 && (
                <Box sx={{ mb: 2 }}><OfflineActionAlert /></Box>
              )}
              {/* Vardiya yok */}
              {!hasShift && (
                <Alert severity="info">Bugün için tanımlı vardiya yok.</Alert>
              )}

              {/* Vardiya tamamlandı */}
              {hasShift && currentStatus === 'clocked_out' && (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1.5,
                    py: 3,
                  }}
                >
                  <CheckCircleIcon sx={{ fontSize: 56, color: C.plum }} />
                  <Typography variant="subtitle1" fontWeight={700} color={C.plum}>
                    Vardiya tamamlandı
                  </Typography>
                  <Typography variant="body2" color="text.secondary" textAlign="center">
                    Bugünkü vardiyanız başarıyla tamamlandı. İyi çalışmalar!
                  </Typography>
                </Box>
              )}

              {/* Vardiya saati */}
              {hasShift && currentStatus && currentStatus !== 'clocked_out' && statusData?.shift_start && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 0.75,
                    mb: 2.5,
                    p: 1.25,
                    bgcolor: statusBg,
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: `${statusColor}25`,
                  }}
                >
                  <AccessTimeIcon sx={{ fontSize: 14, color: statusColor }} />
                  <Typography variant="caption" fontWeight={600} color={statusColor}>
                    Vardiya: {statusData.shift_start.slice(0, 5)} – {statusData.shift_end?.slice(0, 5)}
                  </Typography>
                </Box>
              )}

              {/* Molada uyarı */}
              {hasShift && currentStatus === 'on_break' && (
                <Alert severity="warning" sx={{ mb: 2, borderRadius: 1.5 }}>
                  Molada iken çıkış yapılamaz. Önce moladan dönün.
                </Alert>
              )}

              {/* Amaç butonları */}
              {hasShift && buttons.length > 0 && (
                <Stack spacing={1.5}>
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    fontWeight={600}
                    textAlign="center"
                    sx={{ mb: 0.5, letterSpacing: 0.5 }}
                  >
                    Ne yapmak istiyorsunuz?
                  </Typography>
                  {buttons.map((btn) => (
                    <Button
                      key={btn.action}
                      variant="outlined"
                      color={btn.color}
                      size="large"
                      fullWidth
                      disabled={!online}
                      onClick={() => handleSelectAction(btn.action)}
                      sx={{
                        justifyContent: 'flex-start',
                        gap: 2,
                        py: 1.75,
                        px: 2.5,
                        borderRadius: 2,
                        borderWidth: '1.5px',
                        textAlign: 'left',
                        '&:hover': { borderWidth: '1.5px' },
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 44,
                          height: 44,
                          borderRadius: 1.5,
                          bgcolor:
                            btn.color === 'primary'
                              ? tint(C.brand, 0.1)
                              : btn.color === 'warning'
                              ? tint(C.warning, 0.1)
                              : tint(C.danger, 0.1),
                          flexShrink: 0,
                        }}
                      >
                        {btn.icon}
                      </Box>
                      <Box>
                        <Typography variant="subtitle2" fontWeight={700} display="block">
                          {btn.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" display="block">
                          {btn.description}
                        </Typography>
                      </Box>
                    </Button>
                  ))}
                </Stack>
              )}
            </Box>
          )}

          {/* ── QR SCANNER ── */}
          {pageState === 'scanning' && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                width: '100%',
              }}
            >
              {/* Seçilen amaç özeti */}
              {selectedAction && (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 2,
                    py: 1,
                    bgcolor: tint(C.brand, 0.08),
                    borderRadius: 2,
                    border: `1px solid ${tint(C.brand, 0.2)}`,
                    width: '100%',
                    justifyContent: 'center',
                  }}
                >
                  <QrCodeScannerIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                  <Typography variant="caption" fontWeight={600} color="primary.main">
                    Kiosk QR&apos;ı okutun →{' '}
                    <Box component="span" color="text.primary">
                      {QR_ACTION_LABELS[selectedAction]}
                    </Box>
                  </Typography>
                </Box>
              )}

              {/* Çevrimdışıyken kamera hiç açılmaz; bağlantı gelince tarayıcı kendiliğinden başlar */}
              {online ? (
                <QrScanner
                  onScan={(data) => void handleScan(data)}
                  onError={(e) => setErrorMsg(e)}
                  active={scannerActive}
                />
              ) : (
                <OfflineActionAlert />
              )}

              {online && errorMsg && (
                <Alert severity="error" sx={{ width: '100%', borderRadius: 1.5 }}>{errorMsg}</Alert>
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <LocationOnIcon sx={{ fontSize: 13, color: 'primary.main' }} />
                <Typography variant="caption" color="text.secondary">
                  QR tarandıktan sonra konum doğrulaması yapılır
                </Typography>
              </Box>

              <Button
                variant="text"
                color="inherit"
                size="small"
                startIcon={<ChevronLeftIcon />}
                onClick={handleBackToSelect}
                sx={{ color: 'text.disabled', mt: -1 }}
              >
                Amacı Değiştir
              </Button>
            </Box>
          )}

          {/* ── GPS ALINIYOR ── */}
          {pageState === 'getting_location' && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                py: 4,
                width: '100%',
              }}
            >
              <Box sx={{ position: 'relative', width: 72, height: 72 }}>
                <CircularProgress
                  size={72}
                  thickness={2}
                  sx={{ color: 'primary.main', position: 'absolute', top: 0, left: 0 }}
                />
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MyLocationIcon sx={{ fontSize: 32, color: 'primary.main' }} />
                </Box>
              </Box>
              <Typography variant="subtitle1" fontWeight={700}>
                GPS Konumu Alınıyor
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {locationStatus ?? 'Lütfen bekleyin...'}
              </Typography>
              <Box
                sx={{
                  bgcolor: tint(C.brand, 0.08),
                  border: `1px solid ${tint(C.brand, 0.2)}`,
                  borderRadius: 2,
                  px: 2,
                  py: 1.5,
                  width: '100%',
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  display="block"
                  textAlign="center"
                >
                  📍 Konum izni penceresi açılırsa{' '}
                  <Box component="strong">&ldquo;İzin Ver&rdquo;</Box> seçin
                </Typography>
              </Box>
            </Box>
          )}

          {/* ── İŞLENİYOR ── */}
          {pageState === 'processing' && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5,
                py: 4,
              }}
            >
              <CircularProgress color="primary" size={56} />
              <Typography variant="subtitle2" fontWeight={600}>
                Kaydediliyor...
              </Typography>
            </Box>
          )}

          {/* ── BAŞARILI ── */}
          {pageState === 'success' && result && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.5,
                py: 1,
                width: '100%',
              }}
            >
              <CheckCircleIcon sx={{ fontSize: 72, color: C.success }} />
              <Typography
                variant="h6"
                fontWeight={800}
                color={C.success}
                textAlign="center"
              >
                {result.message}
              </Typography>
              <Typography variant="subtitle2" color="text.primary">
                {employee.full_name}
              </Typography>
              <Chip
                label={ATTENDANCE_STATUS_TR[result.new_status] ?? result.new_status}
                sx={{
                  bgcolor: `${resultStatusColor}20`,
                  color: resultStatusColor,
                  border: '1px solid',
                  borderColor: `${resultStatusColor}40`,
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  height: 32,
                }}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <LocationOnIcon sx={{ fontSize: 13, color: C.success }} />
                <Typography variant="caption" color="text.disabled">
                  {QR_ACTION_LABELS[result.action_type]} — {result.timestamp}
                </Typography>
              </Box>
            </Box>
          )}

          {/* ── HATA ── */}
          {pageState === 'error' && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                py: 1,
                width: '100%',
              }}
            >
              {isLocationError ? (
                <LocationOffIcon sx={{ fontSize: 52, color: 'error.main' }} />
              ) : (
                <ErrorOutlineIcon sx={{ fontSize: 52, color: 'error.main' }} />
              )}
              <Typography
                variant="subtitle2"
                fontWeight={700}
                color="error.main"
                textAlign="center"
                sx={{ whiteSpace: 'pre-line' }}
              >
                {errorMsg ?? 'İşlem başarısız.'}
              </Typography>

              {showLocationPermissionHelp && <PermissionHelp kind="location" />}

              {isLocationRetryable && (
                <Typography variant="caption" color="text.secondary" textAlign="center">
                  Konum servislerinin açık olduğundan emin olun; açık alanda veya pencere kenarında
                  tekrar deneyin. QR kodunu yeniden okutmanız gerekir.
                </Typography>
              )}

              {!online && <OfflineActionAlert />}

              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<RefreshIcon />}
                  onClick={handleRetry}
                  disabled={!online}
                >
                  {isLocationError ? 'Tekrar Tara' : 'Tekrar Dene'}
                </Button>
                <Button
                  variant="text"
                  color="inherit"
                  startIcon={<ChevronLeftIcon />}
                  onClick={handleBackToSelect}
                  sx={{ color: 'text.disabled' }}
                >
                  Geri
                </Button>
              </Stack>
            </Box>
          )}

        </Stack>
      </Paper>
    </Box>
  )
}

