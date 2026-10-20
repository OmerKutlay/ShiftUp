'use client'

/**
 * NotificationsPage — /notifications: güne göre gruplanmış bildirim listesi (Item),
 * okunmamış noktası, "Tümünü okundu say", boş durum (Empty).
 */
import { Bell, CheckCheck, Info, RotateCw, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useNotifications } from '@/hooks/useNotifications'
import { useAuth } from '@/context/AuthContext'
import { Page, PageHeader } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ItemGroup } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Notification } from '@/types/notification'
import { notificationLink } from '@/lib/notificationLinks'
import { PushPermissionCard } from '@/components/pwa/PushPermissionCard'
import { groupNotificationsByDay, NotificationRow, NotificationRowsSkeleton } from './NotificationList'

export function NotificationsPage() {
  const router = useRouter()
  const { employee: authEmployee, status: authStatus } = useAuth()
  const { notifications, unreadCount, isFirstLoad, error, markAsRead, markAllAsRead, refresh } =
    useNotifications(authEmployee?.id ?? null)

  const handleSelect = (n: Notification) => {
    if (!n.is_read) markAsRead(n.id)
    // İlgili sayfaya git (hedef bildirimler sayfasıysa yalnızca okundu işaretlenir)
    const href = notificationLink(n.type)
    if (href !== '/notifications') router.push(href)
  }

  const loading = authStatus === 'loading' || (!!authEmployee && isFirstLoad)
  const groups = groupNotificationsByDay(notifications)

  return (
    <Page size="narrow">
      <PageHeader
        title="Bildirimler"
        titleAdornment={unreadCount > 0 && <Badge variant="secondary" className="tabular-nums max-md:hidden">{unreadCount} yeni</Badge>}
        description={
          loading ? 'Vardiya hatırlatmaları, talep sonuçları ve devam uyarıları'
            : unreadCount > 0 ? `${unreadCount} okunmamış bildirim` : 'Tüm bildirimler okundu'
        }
        actions={
          authEmployee && (
            <>
              <Button variant="outline" onClick={markAllAsRead} disabled={unreadCount === 0} className="max-sm:flex-1">
                <CheckCheck />
                Tümünü okundu say
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={refresh} aria-label="Yenile">
                    <RotateCw />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Yenile</TooltipContent>
              </Tooltip>
            </>
          )
        }
      />

      {authEmployee && <PushPermissionCard hideWhenSubscribed />}

      {authStatus === 'unauthenticated' && (
        <Alert tone="info">
          <Info />
          <AlertDescription>Bildirimleri görmek için giriş yapmanız gerekiyor.</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Bildirimler yüklenemedi</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Card className="gap-0 overflow-hidden py-0 shadow-xs">
          <NotificationRowsSkeleton count={6} />
        </Card>
      ) : notifications.length === 0 ? (
        <Card className="py-0 shadow-xs">
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Bell /></EmptyMedia>
              <EmptyTitle>{authEmployee ? 'Bildirim yok' : 'Giriş yapılmadı'}</EmptyTitle>
              <EmptyDescription>Vardiya hatırlatmaları ve izin bildirimleri burada görünecek.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-5" aria-label="Bildirim listesi" role="region">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`notif-${g.key}`} className="flex flex-col gap-2">
              <h2 id={`notif-${g.key}`} className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground first-letter:uppercase">
                {g.label}
                <span className="text-xs font-normal tabular-nums">{g.items.length}</span>
              </h2>
              <Card className="gap-0 overflow-hidden py-0 shadow-xs">
                <ItemGroup className="divide-y">
                  {g.items.map((n) => (
                    <div key={n.id} role="listitem">
                      <NotificationRow notification={n} onSelect={handleSelect} />
                    </div>
                  ))}
                </ItemGroup>
              </Card>
            </section>
          ))}
        </div>
      )}
    </Page>
  )
}
