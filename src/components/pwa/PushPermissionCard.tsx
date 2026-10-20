'use client'

/**
 * PushPermissionCard — bu cihazda push bildirimlerini açma/kapatma.
 *
 * İki görünüm:
 *   - Ayarlar › Bildirimler: başlıklı kart, "Bu cihazda bildirimler" anahtarı (Switch) ve durum açıklaması
 *   - Bildirimler sayfası (hideWhenSubscribed): kompakt öneri satırı (Item) + "Aç" düğmesi;
 *     abonelik açıkken hiç görünmez
 *
 * Durumlar: desteklenmiyor / iOS'ta ana ekrana ekleme gerekli / izin sorulmadı /
 * açık (abone) / izin verilmiş ama abone değil / reddedilmiş (ayarlardan açma yönergesi).
 */
import { BellOff, BellRing, Share, TriangleAlert } from 'lucide-react'
import { usePushSubscription, type PushStatus } from '@/hooks/usePushSubscription'
import { isIos } from '@/lib/pwa/push'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface Props {
  /** Abonelik açıkken kartı tamamen gizle (Bildirimler sayfasındaki kompakt öneri) */
  hideWhenSubscribed?: boolean
  className?: string
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

/** Kullanıcının bu cihazda düzeltebileceği engel (izin, kurulum, sürüm, tarayıcı) */
function blockerTitle(status: PushStatus): string | null {
  switch (status) {
    case 'denied': return 'Bildirim izni engellenmiş'
    case 'ios-needs-install': return 'Ana ekrana ekleme gerekli'
    case 'ios-too-old': return 'iOS sürümü eski'
    case 'unsupported': return 'Tarayıcı desteklemiyor'
    case 'disabled': return 'Sunucu yapılandırılmadı'
    default: return null
  }
}

export function PushPermissionCard({ hideWhenSubscribed = false, className }: Props) {
  const { status, busy, error, enable, disable } = usePushSubscription()

  const canEnable = status === 'default' || status === 'granted'
  const isOn = status === 'subscribed'

  // ── Kompakt öneri (Bildirimler sayfası) ──
  if (hideWhenSubscribed) {
    // Sunucu yapılandırılmamışsa ya da açıksa kullanıcıya gösterilecek bir eylem yok
    if (status === 'loading' || status === 'disabled' || isOn) return null
    const Icon = status === 'ios-needs-install' ? Share : canEnable ? BellRing : BellOff
    return (
      <Item variant="outline" className={cn('bg-card shadow-xs', className)}>
        <ItemMedia variant="icon"><Icon /></ItemMedia>
        <ItemContent className="min-w-48">
          <ItemTitle>Vardiya hatırlatmaları ve onaylar için bildirimleri açın</ItemTitle>
          <ItemDescription className="line-clamp-none">{error ?? statusText(status)}</ItemDescription>
        </ItemContent>
        {canEnable && (
          <ItemActions className="w-full sm:w-auto">
            <Button size="sm" onClick={() => void enable()} disabled={busy} className="w-full sm:w-auto">
              {busy && <Spinner />}
              Aç
            </Button>
          </ItemActions>
        )}
      </Item>
    )
  }

  // ── Ayarlar kartı ──
  const blocker = blockerTitle(status)
  return (
    <Card className={cn('gap-5 shadow-xs', className)}>
      <CardHeader className="px-4 md:px-6">
        <CardTitle>Anlık bildirimler</CardTitle>
        <CardDescription>İzin talepleri, onaylar ve vardiya hatırlatmaları uygulama kapalıyken de bu cihaza gelir.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4 md:px-6">
        {status === 'loading' ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : (
          <Field orientation="horizontal" data-disabled={!canEnable && !isOn ? true : undefined} className="rounded-lg border p-4">
            <FieldContent>
              <FieldLabel htmlFor="push-toggle">Bu cihazda bildirimler</FieldLabel>
              <FieldDescription>{isOn ? 'Açık — bildirimler bu cihaza gönderiliyor.' : canEnable ? statusText(status) : 'Kapalı'}</FieldDescription>
            </FieldContent>
            <span className="flex items-center gap-2">
              {busy && <Spinner className="text-muted-foreground" />}
              <Switch
                id="push-toggle"
                checked={isOn}
                disabled={busy || (!canEnable && !isOn)}
                onCheckedChange={(v) => void (v ? enable() : disable())}
              />
            </span>
          </Field>
        )}
        {blocker && (
          <Alert tone="warning">
            <TriangleAlert />
            <AlertTitle>{blocker}</AlertTitle>
            <AlertDescription>{statusText(status)}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
