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
import { Coffee, Info, LogIn, LogOut, Undo2, type LucideIcon } from 'lucide-react'
import type { QrActionType } from '@/types/qr'
import type { AttendanceStatus } from '@/types/attendance'
import type { GpsCoordinates } from '@/types/location'
import type { BreakItem } from '@/lib/attendanceDurations'
import type { BadgeTone } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  /** Bugünkü molalar sırayla (son öğe sürüyor olabilir) */
  breaks?: BreakItem[]
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
  shift_waiting: 'Vardiya bekleniyor',
  working: 'Çalışıyor',
  on_break: 'Molada',
  working_after_break: 'Çalışıyor',
  clocked_out: 'Vardiya tamamlandı',
}

/** Durum rozeti tonu */
export const STATUS_TONES: Record<string, BadgeTone> = {
  working: 'success',
  on_break: 'warning',
  working_after_break: 'success',
  clocked_out: 'plum',
  shift_waiting: 'neutral',
}

// ─── Aksiyon buton tanımları ──────────────────────────────────

export interface ActionButton {
  action: QrActionType
  label: string
  description: string
  icon: LucideIcon
  tone: 'brand' | 'warning' | 'danger'
  /** Birincil (primary renkli) düğme; diğerleri secondary renkte gösterilir */
  primary: boolean
}

/**
 * Duruma göre düğmeler — primary olan önce gelir:
 *   shift_waiting       → Giriş yap (primary)
 *   working             → Molaya çık (primary), Çıkış yap (secondary)
 *   on_break            → Moladan dön (primary)
 *   working_after_break → Çıkış yap (primary), Molaya çık (secondary — ikinci molaya karışılmaz;
 *                          fazla mola çalışma süresinden düşülür)
 */

export function getButtons(status: AttendanceStatus | null): ActionButton[] {
  switch (status) {
    case 'shift_waiting':
      return [
        {
          action: 'clock_in',
          label: 'Giriş yap',
          description: 'Vardiyama başlamak istiyorum',
          icon: LogIn,
          tone: 'brand',
          primary: true,
        },
      ]
    case 'working':
      return [
        {
          action: 'break_start',
          label: 'Molaya çık',
          description: 'Mola vermek istiyorum',
          icon: Coffee,
          tone: 'warning',
          primary: true,
        },
        {
          action: 'clock_out',
          label: 'Çıkış yap',
          description: 'Vardiyamı tamamlamak istiyorum',
          icon: LogOut,
          tone: 'danger',
          primary: false,
        },
      ]
    case 'on_break':
      return [
        {
          action: 'break_end',
          label: 'Moladan dön',
          description: 'Molam bitti, işe dönüyorum',
          icon: Undo2,
          tone: 'brand',
          primary: true,
        },
        // Molada çıkış yok — kural gereği dahil edilmedi
      ]
    case 'working_after_break':
      return [
        {
          action: 'clock_out',
          label: 'Çıkış yap',
          description: 'Vardiyamı tamamlamak istiyorum',
          icon: LogOut,
          tone: 'danger',
          primary: true,
        },
        {
          action: 'break_start',
          label: 'Molaya çık',
          description: 'Tekrar mola vermek istiyorum',
          icon: Coffee,
          tone: 'warning',
          primary: false,
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
    <Alert className="text-left">
      <Info />
      <AlertTitle>{kind === 'camera' ? 'Kamera izni nasıl verilir?' : 'Konum izni nasıl verilir?'}</AlertTitle>
      <AlertDescription>
        <ol className="list-decimal space-y-1 pl-4">
          {steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </AlertDescription>
    </Alert>
  )
}
