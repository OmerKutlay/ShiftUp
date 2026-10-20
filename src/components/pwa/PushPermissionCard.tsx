'use client'

/**
 * PushPermissionCard — bu cihazda push bildirimlerini açma/kapatma.
 *
 * Açıklamalı kart (Bildirimler sayfasının üstü, Ayarlar › Bildirimler).
 *
 * Durumlar: desteklenmiyor / iOS'ta ana ekrana ekleme gerekli / izin sorulmadı /
 * açık (abone) / izin verilmiş ama abone değil / reddedilmiş (ayarlardan açma yönergesi).
 */
import { BellOff, BellRing, Loader2, Share, TriangleAlert } from 'lucide-react'
import { usePushSubscription, type PushStatus } from '@/hooks/usePushSubscription'
import { isIos } from '@/lib/pwa/push'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  /** Abonelik açıkken kartı tamamen gizle */
  hideWhenSubscribed?: boolean
}

function deniedHelp(): string {
  if (isIos()) return 'Ayarlar › Bildirimler › ShiftUp bölümünden bildirimlere izin verin.'
  return 'Tarayıcının adres çubuğundaki site ayarlarından (kilit simgesi) Bildirimler iznini "İzin ver" yapın, ardından sayfayı yenileyin.'
}

function statusText(status: PushStatus): string {
  switch (status) {
    case 'subscribed':
      return 'Bu cihazda bildirimler açık.'
    case 'granted':
    case 'default':
      return 'Vardiya hatırlatmaları ve talep onayları anında telefonunuza gelsin.'
    case 'denied':
      return `Bildirim izni engellenmiş. ${deniedHelp()}`
    case 'ios-needs-install':
      return 'iPhone/iPad’de bildirimler için ShiftUp’ı ana ekrana ekleyin: Paylaş › Ana Ekrana Ekle, ardından uygulamayı ana ekrandan açın.'
    case 'ios-too-old':
      return 'Bildirimler için iOS 16.4 veya üzeri gerekir.'
    case 'disabled':
      return 'Anlık bildirimler henüz yapılandırılmadı.'
    case 'unsupported':
      return 'Bu tarayıcı anlık bildirimleri desteklemiyor.'
    default:
      return ''
  }
}

export function PushPermissionCard({ hideWhenSubscribed = false }: Props) {
  const { status, busy, error, enable, disable } = usePushSubscription()

  if (status === 'loading') return null
  // Sunucu yapılandırılmamışsa kullanıcıya gösterilecek bir eylem yok
  if (status === 'disabled') return null

  const canEnable = status === 'default' || status === 'granted'
  const isOn = status === 'subscribed'

  if (isOn && hideWhenSubscribed) return null

  const Icon = status === 'ios-needs-install' ? Share : isOn || canEnable ? BellRing : BellOff

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
            isOn ? 'bg-success-soft text-success' : 'bg-brand-soft text-brand'
          )}
        >
          <Icon />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold">
            {isOn ? 'Bildirimler açık' : 'Vardiya hatırlatmaları ve onaylar için bildirimleri aç'}
          </p>
          <p className="mt-0.5 text-sm text-ink-secondary">{statusText(status)}</p>
          {error && (
            <Alert tone="warning" className="mt-2 py-2">
              <TriangleAlert />
              <AlertDescription className="text-ink">{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>
      {canEnable && (
        <Button
          size="sm"
          onClick={() => void enable()}
          disabled={busy}
          className="shrink-0 self-stretch sm:self-center"
        >
          {busy && <Loader2 className="animate-spin" />}
          Aç
        </Button>
      )}
      {isOn && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void disable()}
          disabled={busy}
          className="shrink-0 self-end text-ink-secondary sm:self-center"
        >
          Kapat
        </Button>
      )}
    </div>
  )
}
