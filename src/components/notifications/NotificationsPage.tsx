'use client'

/**
 * NotificationsPage — FAZ 10
 * /notifications sayfası için tam liste görünümü.
 */
import { Bell, CircleAlert, Info, RefreshCw, User } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useRouter } from 'next/navigation'
import { useNotifications } from '@/hooks/useNotifications'
import { useAuth } from '@/context/AuthContext'
import { PageHeader, ListSkeleton } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Notification } from '@/types/notification'
import { humanizeIsoDates } from '@/lib/dateUtils'
import { notificationLink } from '@/lib/notificationLinks'
import { PushPermissionCard } from '@/components/pwa/PushPermissionCard'
import { cn } from '@/lib/utils'
import { ICON_TONE_CLASS, notificationMeta } from './notificationMeta'

function NotificationItem({
  notification,
  onMarkAsRead,
}: {
  notification: Notification
  onMarkAsRead: (id: string) => void
}) {
  const router = useRouter()
  const meta = notificationMeta(notification.type)
  const Icon = meta.Icon
  const unread = !notification.is_read
  const timeAgo = formatDistanceToNow(new Date(notification.created_at), {
    addSuffix: true,
    locale: tr,
  })
  const fullDate = format(new Date(notification.created_at), 'd MMM yyyy, HH:mm', { locale: tr })

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (unread) onMarkAsRead(notification.id)
          // İlgili sayfaya git (hedef bildirimler sayfasıysa yalnızca okundu işaretlenir)
          const href = notificationLink(notification.type)
          if (href !== '/notifications') router.push(href)
        }}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors outline-none focus-visible:bg-muted',
          unread ? 'bg-brand-soft/45 hover:bg-brand-soft/70' : 'hover:bg-muted/70'
        )}
      >
        <span
          aria-hidden
          className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]', ICON_TONE_CLASS[meta.tone])}
        >
          <Icon />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn('text-sm text-ink', unread ? 'font-bold' : 'font-medium')}>{notification.title}</span>
            <Badge tone={meta.tone} className="h-5 px-1.5 text-[0.68rem]">{meta.label}</Badge>
          </span>
          <span className="mt-1 block text-sm text-ink-secondary">{humanizeIsoDates(notification.message)}</span>
          <span className="mt-1 block text-xs text-ink-muted" title={fullDate}>
            {timeAgo}
          </span>
        </span>

        {unread && (
          <span className="mt-2 size-2 shrink-0 rounded-full bg-primary">
            <span className="sr-only">Yeni</span>
          </span>
        )}
      </button>
    </li>
  )
}

export function NotificationsPage() {
  const { employee: authEmployee, status: authStatus } = useAuth()
  const { notifications, unreadCount, isFirstLoad, error, markAsRead, markAllAsRead, refresh } =
    useNotifications(authEmployee?.id ?? null)

  return (
    <div className="mx-auto w-full max-w-[720px] p-4 md:p-6">
      <PageHeader
        title="Bildirimler"
        titleAdornment={unreadCount > 0 && <Badge tone="solid">{unreadCount} okunmamış</Badge>}
        subtitle={
          authEmployee && (
            <span className="inline-flex items-center gap-1">
              <User className="size-3.5" aria-hidden />
              {authEmployee.full_name}
            </span>
          )
        }
        actions={
          <>
            {unreadCount > 0 && (
              <Button size="sm" variant="outline" onClick={markAllAsRead}>
                Tümünü okundu işaretle
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshCw />
              Yenile
            </Button>
          </>
        }
      />

      {authEmployee && <PushPermissionCard hideWhenSubscribed />}

      {authStatus === 'unauthenticated' && (
        <Alert tone="info" className="mb-4">
          <Info />
          <AlertDescription className="text-ink">Bildirimleri görmek için giriş yapmanız gerekiyor.</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert tone="danger" className="mb-4">
          <CircleAlert />
          <AlertDescription className="text-ink">{error}</AlertDescription>
        </Alert>
      )}

      <section aria-label="Bildirim listesi" className="overflow-hidden rounded-2xl border bg-card">
        {authStatus === 'loading' || (authEmployee && isFirstLoad) ? (
          <ListSkeleton count={6} variant="plain" actions={0} />
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-surface-muted text-ink-muted">
              <Bell className="size-6" aria-hidden />
            </span>
            <p className="font-semibold text-ink">
              {authEmployee ? 'Henüz bildirim bulunmuyor' : 'Giriş yapılmadı'}
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              Vardiya hatırlatmaları ve izin bildirimleri burada görünecek
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {notifications.map((n) => (
              <NotificationItem key={n.id} notification={n} onMarkAsRead={markAsRead} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
