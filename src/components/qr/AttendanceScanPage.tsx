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
 */
import { useState, useEffect, useCallback } from 'react'
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
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import LoginIcon from '@mui/icons-material/Login'
import LogoutIcon from '@mui/icons-material/Logout'
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import PersonIcon from '@mui/icons-material/Person'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import RefreshIcon from '@mui/icons-material/Refresh'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import LocationOffIcon from '@mui/icons-material/LocationOff'
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner'
import type { QrActionType } from '@/types/qr'
import { QR_ACTION_LABELS } from '@/types/qr'
import type { AttendanceStatus } from '@/types/attendance'
import type { ProcessQrResponse } from '@/types/qr'
import type { GpsCoordinates } from '@/types/location'
import { useAuth } from '@/context/AuthContext'
import { QrScanner } from './QrScanner'

// ─── Types ────────────────────────────────────────────────────

interface CurrentStatusResponse {
  has_shift: boolean
  shift_id?: string
  shift_start?: string
  shift_end?: string
  current_status: AttendanceStatus | null
  suggested_action: QrActionType | null
  allowed_actions: QrActionType[]
}

/**
 * Sayfa akış aşamaları:
 *   loading_status  — mevcut durum API'dan çekiliyor
 *   select_action   — kullanıcı amaç seçiyor (ana ekran)
 *   scanning        — QR scanner açık, tarama bekleniyor
 *   getting_location — GPS alınıyor
 *   processing      — API isteği gönderiliyor
 *   success         — işlem başarılı
 *   error           — işlem veya durum yüklenme hatası
 */
type PageState =
  | 'loading_status'
  | 'select_action'
  | 'scanning'
  | 'getting_location'
  | 'processing'
  | 'success'
  | 'error'

// ─── Sabitler ─────────────────────────────────────────────────

const ATTENDANCE_STATUS_TR: Record<string, string> = {
  shift_waiting: 'Vardiya Bekleniyor',
  working: 'Çalışıyor',
  on_break: 'Molada',
  working_after_break: 'Çalışıyor',
  clocked_out: 'Vardiya Tamamlandı',
}

const STATUS_COLORS: Record<string, string> = {
  working: '#10b981',
  on_break: '#f59e0b',
  working_after_break: '#10b981',
  clocked_out: '#818cf8',
  shift_waiting: '#64748b',
}

const STATUS_BG_COLORS: Record<string, string> = {
  working: 'rgba(16,185,129,0.08)',
  on_break: 'rgba(245,158,11,0.08)',
  working_after_break: 'rgba(16,185,129,0.08)',
  clocked_out: 'rgba(129,140,248,0.08)',
  shift_waiting: 'rgba(100,116,139,0.08)',
}

// ─── Aksiyon buton tanımları ──────────────────────────────────

interface ActionButton {
  action: QrActionType
  label: string
  description: string
  icon: React.ReactNode
  color: 'primary' | 'warning' | 'error'
}

function getButtons(status: AttendanceStatus | null): ActionButton[] {
  switch (status) {
    case 'shift_waiting':
      return [
        {
          action: 'clock_in',
          label: 'Giriş Yap',
          description: 'Vardiyama başlamak istiyorum',
          icon: <LoginIcon sx={{ fontSize: 28 }} />,
          color: 'primary',
        },
      ]
    case 'working':
      return [
        {
          action: 'break_start',
          label: 'Molaya Çık',
          description: 'Mola vermek istiyorum',
          icon: <FreeBreakfastIcon sx={{ fontSize: 28 }} />,
          color: 'warning',
        },
        {
          action: 'clock_out',
          label: 'Çıkış Yap',
          description: 'Vardiyamı tamamlamak istiyorum',
          icon: <LogoutIcon sx={{ fontSize: 28 }} />,
          color: 'error',
        },
      ]
    case 'on_break':
      return [
        {
          action: 'break_end',
          label: 'Moladan Dön',
          description: 'Molam bitti, işe dönüyorum',
          icon: <ArrowBackIcon sx={{ fontSize: 28 }} />,
          color: 'primary',
        },
        // Molada çıkış yok — kural gereği dahil edilmedi
      ]
    case 'working_after_break':
      return [
        {
          action: 'break_start',
          label: 'Molaya Çık',
          description: 'Tekrar mola vermek istiyorum',
          icon: <FreeBreakfastIcon sx={{ fontSize: 28 }} />,
          color: 'warning',
        },
        {
          action: 'clock_out',
          label: 'Çıkış Yap',
          description: 'Vardiyamı tamamlamak istiyorum',
          icon: <LogoutIcon sx={{ fontSize: 28 }} />,
          color: 'error',
        },
      ]
    default:
      return []
  }
}

// ─── GPS yardımcısı ───────────────────────────────────────────

function getCurrentPosition(): Promise<GpsCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Tarayıcınız konum özelliğini desteklemiyor.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => {
        if (err.code === 1) {
          reject(
            new Error(
              'Konum izni alınamadı.\nSafari: Adres çubuğundaki "AA" → Site Ayarları → Konum → İzin Ver.'
            )
          )
        } else if (err.code === 2) {
          reject(new Error('GPS sinyali alınamadı. Açık alanda tekrar deneyin.'))
        } else if (err.code === 3) {
          reject(new Error('Konum alınırken zaman aşımı. Tekrar deneyin.'))
        } else {
          reject(new Error(`Konum alınamadı (${err.message}).`))
        }
      },
      { maximumAge: 0, timeout: 15000, enableHighAccuracy: true }
    )
  })
}

// ─── Ana Component ────────────────────────────────────────────

export function AttendanceScanPage() {
  const { employee, status: authStatus } = useAuth()

  const [pageState, setPageState] = useState<PageState>('loading_status')
  const [statusData, setStatusData] = useState<CurrentStatusResponse | null>(null)
  const [selectedAction, setSelectedAction] = useState<QrActionType | null>(null)
  const [scannerActive, setScannerActive] = useState(false)
  const [result, setResult] = useState<ProcessQrResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [locationStatus, setLocationStatus] = useState<string | null>(null)

  // ── Mevcut durumu çek ───────────────────────────────────────
  const fetchCurrentStatus = useCallback(async () => {
    setPageState('loading_status')
    setErrorMsg(null)
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
      setPageState('select_action')
    } catch {
      setErrorMsg('Sunucuya bağlanılamadı.')
      setPageState('error')
    }
  }, [])

  useEffect(() => {
    if (authStatus === 'authenticated' && employee) {
      void fetchCurrentStatus()
    }
  }, [authStatus, employee, fetchCurrentStatus])

  // ── Amaç seçildi → scanner ekranına geç ─────────────────────
  const handleSelectAction = (action: QrActionType) => {
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
      setPageState('getting_location')
      setLocationStatus('GPS konumu alınıyor...')

      let location: GpsCoordinates | undefined
      try {
        location = await getCurrentPosition()
        setLocationStatus(`Konum alındı (±${Math.round(location.accuracy)}m)`)
      } catch (locErr) {
        setErrorMsg(locErr instanceof Error ? locErr.message : 'Konum alınamadı.')
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
        setErrorMsg(err instanceof Error ? err.message : 'Bilinmeyen hata.')
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
    setLocationStatus(null)
    setPageState('select_action')
  }

  // ── Hata sonrası tekrar dene ─────────────────────────────────
  const handleRetry = () => {
    setErrorMsg(null)
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
          minHeight: '100dvh',
          bgcolor: '#0f172a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    )
  }

  if (authStatus === 'unauthenticated' || !employee) {
    return (
      <Box
        sx={{
          minHeight: '100dvh',
          bgcolor: '#0f172a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
        }}
      >
        <Alert severity="warning">Devam takibi için sisteme giriş yapmanız gerekiyor.</Alert>
      </Box>
    )
  }

  // ─── Yardımcı değerler ───────────────────────────────────────
  const currentStatus = statusData?.current_status ?? null
  const statusColor = STATUS_COLORS[currentStatus ?? ''] ?? '#94a3b8'
  const statusBg = STATUS_BG_COLORS[currentStatus ?? ''] ?? 'rgba(100,116,139,0.08)'
  const statusLabel = ATTENDANCE_STATUS_TR[currentStatus ?? ''] ?? '—'
  const buttons = getButtons(currentStatus)
  const hasShift = statusData?.has_shift ?? false
  const resultStatusColor = result ? (STATUS_COLORS[result.new_status] ?? '#94a3b8') : '#94a3b8'

  const isLocationError =
    !!errorMsg &&
    (errorMsg.toLowerCase().includes('konum') ||
      errorMsg.toLowerCase().includes('gps') ||
      errorMsg.toLowerCase().includes('izin'))

  // ─── Render ──────────────────────────────────────────────────
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: '#0f172a',
        color: 'text.primary',
        p: { xs: 2, md: 4 },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Header */}
      <Box sx={{ mb: 3, textAlign: 'center' }}>
        <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5}>
          Attendance
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
            bgcolor: 'rgba(20,184,166,0.06)',
            borderRadius: 1.5,
            border: '1px solid rgba(20,184,166,0.15)',
          }}
        >
          {(pageState === 'scanning') && (
            <IconButton
              size="small"
              onClick={handleBackToSelect}
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
              {employee.role}
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

        <Divider sx={{ mb: 3, borderColor: 'rgba(255,255,255,0.08)' }} />

        <Stack spacing={2.5} alignItems="center">

          {/* ── DURUM YÜKLENİYOR ── */}
          {pageState === 'loading_status' && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                py: 4,
              }}
            >
              <CircularProgress color="primary" size={48} />
              <Typography variant="subtitle2" color="text.secondary">
                Vardiya durumu yükleniyor...
              </Typography>
            </Box>
          )}

          {/* ── AMAÇ SEÇİMİ ── */}
          {pageState === 'select_action' && (
            <Box sx={{ width: '100%' }}>
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
                  <CheckCircleIcon sx={{ fontSize: 56, color: '#818cf8' }} />
                  <Typography variant="subtitle1" fontWeight={700} color="#818cf8">
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
                    NE YAPMAK İSTİYORSUNUZ?
                  </Typography>
                  {buttons.map((btn) => (
                    <Button
                      key={btn.action}
                      variant="outlined"
                      color={btn.color}
                      size="large"
                      fullWidth
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
                              ? 'rgba(20,184,166,0.1)'
                              : btn.color === 'warning'
                              ? 'rgba(245,158,11,0.1)'
                              : 'rgba(239,68,68,0.1)',
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
                    bgcolor: 'rgba(20,184,166,0.08)',
                    borderRadius: 2,
                    border: '1px solid rgba(20,184,166,0.2)',
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

              <QrScanner
                onScan={(data) => void handleScan(data)}
                onError={(e) => setErrorMsg(e)}
                active={scannerActive}
              />

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
                  bgcolor: 'rgba(20,184,166,0.08)',
                  border: '1px solid rgba(20,184,166,0.2)',
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
              <CheckCircleIcon sx={{ fontSize: 72, color: '#10b981' }} />
              <Typography
                variant="h6"
                fontWeight={800}
                color="#10b981"
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
                <LocationOnIcon sx={{ fontSize: 13, color: '#10b981' }} />
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

              {isLocationError && (
                <Box
                  sx={{
                    bgcolor: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.2)',
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
                    fontWeight={600}
                    mb={0.5}
                  >
                    📱 Safari konum izni nasıl verilir?
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    display="block"
                    component="div"
                  >
                    1. Adres çubuğundaki <strong>AA</strong> simgesine dokun
                    <br />
                    2. <strong>Site Ayarları</strong> → Konum → <strong>İzin Ver</strong>
                    <br />
                    3. Sayfayı yenile ve tekrar dene
                  </Typography>
                </Box>
              )}

              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<RefreshIcon />}
                  onClick={handleRetry}
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
