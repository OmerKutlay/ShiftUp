'use client'

/**
 * NotificationPanel — zilin açılır paneli (NotificationBell'in Popover'ı içinde).
 * Sayfayla aynı satır (NotificationRow) ve gün başlıkları, daha sıkı yerleşim.
 */
import { BellOff, CheckCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { Notification } from '@/types/notification'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ItemGroup } from '@/components/ui/item'
import { PopoverContent } from '@/components/ui/popover'
import { notificationLink } from '@/lib/notificationLinks'
import { groupNotificationsByDay, NotificationRow, NotificationRowsSkeleton } from './NotificationList'

interface Props {
  /** Masaüstünde yan menünün sağına, telefonda zilin altına açılır */
  side: 'right' | 'bottom'
  onClose: () => void
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
}

export function NotificationPanel({
  side,
  onClose,
  notifications,
  unreadCount,
  loading,
  onMarkAsRead,
  onMarkAllAsRead,
}: Props) {
  const router = useRouter()

  const handleSelect = (n: Notification) => {
    if (!n.is_read) onMarkAsRead(n.id)
    onClose()
    // İlgili sayfaya git (izin → /leave, hatırlatma → /my-schedule …)
    router.push(notificationLink(n.type, n.related_id))
  }

  const groups = groupNotificationsByDay(notifications)

  return (
    <PopoverContent
      side={side}
      align="end"
      sideOffset={8}
      collisionPadding={16}
      aria-label="Bildirimler"
      className="flex max-h-[min(520px,var(--radix-popover-content-available-height))] w-[calc(100vw-32px)] flex-col overflow-hidden p-0 sm:w-96"
    >
      {/* Başlık */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b py-2 pr-2 pl-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Bildirimler</h2>
          {unreadCount > 0 && <Badge variant="secondary" className="tabular-nums">{unreadCount} yeni</Badge>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onMarkAllAsRead}
          disabled={unreadCount === 0}
          className="text-muted-foreground"
        >
          <CheckCheck />
          Tümünü okundu say
        </Button>
      </div>

      {/* Liste */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading && notifications.length === 0 ? (
          <NotificationRowsSkeleton count={4} compact />
        ) : notifications.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon"><BellOff /></EmptyMedia>
              <EmptyTitle className="text-base">Bildirim yok</EmptyTitle>
              <EmptyDescription>Vardiya hatırlatmaları ve talep sonuçları burada görünür.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h3 className="sticky top-0 z-10 border-b bg-muted px-4 py-1.5 text-xs font-medium text-muted-foreground first-letter:uppercase">
                {g.label}
              </h3>
              <ItemGroup className="divide-y">
                {g.items.map((n) => (
                  <div key={n.id} role="listitem">
                    <NotificationRow notification={n} onSelect={handleSelect} compact />
                  </div>
                ))}
              </ItemGroup>
            </section>
          ))
        )}
      </div>

      {/* Alt bilgi — tüm bildirimlere git */}
      <div className="shrink-0 border-t p-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => {
            onClose()
            router.push('/notifications')
          }}
        >
          Tüm bildirimleri gör
        </Button>
      </div>
    </PopoverContent>
  )
}
