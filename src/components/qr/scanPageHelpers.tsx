/**
 * scanPageHelpers — QR tarama ekranının tipleri, sabitleri, aksiyon butonları ve GPS yardımcısı.
 */
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
import LoginIcon from '@mui/icons-material/Login'
import LogoutIcon from '@mui/icons-material/Logout'
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import type { QrActionType } from '@/types/qr'
import type { AttendanceStatus } from '@/types/attendance'
import type { GpsCoordinates } from '@/types/location'
import { Box, Typography } from '@mui/material'
import { detectPlatform, isStandaloneDisplay } from '@/lib/pwa/deviceInfo'

// ─── Types ────────────────────────────────────────────────────

export interface CurrentStatusResponse {
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
export type PageState =
  | 'loading_status'
  | 'select_action'
  | 'scanning'
  | 'getting_location'
  | 'processing'
  | 'success'
  | 'error'

// ─── Sabitler ─────────────────────────────────────────────────

export const ATTENDANCE_STATUS_TR: Record<string, string> = {
  shift_waiting: 'Vardiya Bekleniyor',
  working: 'Çalışıyor',
  on_break: 'Molada',
  working_after_break: 'Çalışıyor',
  clocked_out: 'Vardiya Tamamlandı',
}

export const STATUS_COLORS: Record<string, string> = {
  working: '#10b981',
  on_break: '#f59e0b',
  working_after_break: '#10b981',
  clocked_out: '#818cf8',
  shift_waiting: '#64748b',
}

export const STATUS_BG_COLORS: Record<string, string> = {
  working: 'rgba(16,185,129,0.08)',
  on_break: 'rgba(245,158,11,0.08)',
  working_after_break: 'rgba(16,185,129,0.08)',
  clocked_out: 'rgba(129,140,248,0.08)',
  shift_waiting: 'rgba(100,116,139,0.08)',
}

// ─── Aksiyon buton tanımları ──────────────────────────────────

export interface ActionButton {
  action: QrActionType
  label: string
  description: string
  icon: React.ReactNode
  color: 'primary' | 'warning' | 'error'
}

export function getButtons(status: AttendanceStatus | null): ActionButton[] {
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

/** Konum hatasının türü — ekranda doğru yönlendirmeyi seçmek için */
export type LocationErrorKind = 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'unknown'

export class LocationError extends Error {
  constructor(message: string, public kind: LocationErrorKind) {
    super(message)
    this.name = 'LocationError'
  }
}

export function getCurrentPosition(): Promise<GpsCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationError('Tarayıcınız konum özelliğini desteklemiyor.', 'unsupported'))
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
          reject(new LocationError('Konum izni alınamadı.', 'denied'))
        } else if (err.code === 2) {
          reject(new LocationError('GPS sinyali alınamadı. Açık alanda tekrar deneyin.', 'unavailable'))
        } else if (err.code === 3) {
          reject(new LocationError('Konum alınırken zaman aşımı. Tekrar deneyin.', 'timeout'))
        } else {
          reject(new LocationError(`Konum alınamadı (${err.message}).`, 'unknown'))
        }
      },
      { maximumAge: 0, timeout: 15000, enableHighAccuracy: true }
    )
  })
}

// ─── İzin yönlendirmesi ───────────────────────────────────────

export type PermissionKind = 'camera' | 'location'

/**
 * Reddedilmiş kamera / konum izninin cihaza göre nasıl açılacağı.
 * Ana ekrana eklenmiş uygulamada (standalone) adres çubuğu yoktur; yönlendirme buna göre değişir.
 */
export function permissionHelpSteps(
  kind: PermissionKind,
  platform = detectPlatform(),
  standalone = isStandaloneDisplay(),
): string[] {
  const label = kind === 'camera' ? 'Kamera' : 'Konum'
  if (platform === 'ios') {
    const iosSetting = kind === 'camera'
      ? 'Ayarlar → Safari → Kamera → İzin Ver (veya Sor)'
      : 'Ayarlar → Gizlilik ve Güvenlik → Konum Servisleri → Safari Web Siteleri → Uygulamayı Kullanırken'
    return standalone
      ? [iosSetting, 'ShiftUp uygulamasını tamamen kapatıp yeniden açın', 'Tekrar deneyin; izin sorulursa "İzin Ver" seçin']
      : [`Adres çubuğundaki "AA" simgesine dokunun → Web Sitesi Ayarları → ${label} → İzin Ver`, `Seçenek görünmüyorsa: ${iosSetting}`, 'Sayfayı yenileyip tekrar deneyin']
  }
  if (platform === 'android') {
    return standalone
      ? ['ShiftUp simgesine uzun basın → Uygulama bilgisi → İzinler', `${label} → İzin ver`, 'Uygulamayı yeniden açıp tekrar deneyin']
      : [`Adres çubuğundaki ayar/kilit simgesine dokunun → İzinler → ${label} → İzin ver`, `Alternatif: Chrome → Ayarlar → Site ayarları → ${label}`, 'Sayfayı yenileyip tekrar deneyin']
  }
  return [`Adres çubuğundaki kilit simgesinden ${label.toLowerCase()} iznini açın`, 'Sayfayı yenileyip tekrar deneyin']
}

/** İzin yönlendirme kutusu (kamera / konum reddedildiğinde) */
export function PermissionHelp({ kind }: { kind: PermissionKind }) {
  const steps = permissionHelpSteps(kind)
  return (
    <Box
      sx={{
        bgcolor: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.2)',
        borderRadius: 2,
        px: 2,
        py: 1.5,
        width: '100%',
        textAlign: 'left',
      }}
    >
      <Typography variant="caption" color="text.secondary" display="block" fontWeight={600} mb={0.5}>
        {kind === 'camera' ? 'Kamera izni nasıl verilir?' : 'Konum izni nasıl verilir?'}
      </Typography>
      <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
        {steps.map((step) => (
          <Typography key={step} component="li" variant="caption" color="text.disabled">
            {step}
          </Typography>
        ))}
      </Box>
    </Box>
  )
}
