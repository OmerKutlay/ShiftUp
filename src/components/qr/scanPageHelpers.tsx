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

export function getCurrentPosition(): Promise<GpsCoordinates> {
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

