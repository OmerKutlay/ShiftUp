'use client'

/**
 * NotificationPanel — FAZ 10
 * Bildirim listesi açılır paneli (NotificationBell'in Popover'ı içinde render edilir).
 */
import { BellOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { Notification } from '@/types/notification'
import { ListSkeleton } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PopoverContent } from '@/components/ui/popover'
import { humanizeIsoDates } from '@/lib/dateUtils'
import { notificationLink } from '@/lib/notificationLinks'
import { cn } from '@/lib/utils'
import { ICON_TONE_CLASS, notificationMeta } from './notificationMeta'

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

  const handleItemClick = (n: Notification) => {
    if (!n.is_read) onMarkAsRead(n.id)
    onClose()
    // İlgili sayfaya git (izin → /leave, hatırlatma → /my-schedule …)
    router.push(notificationLink(n.type))
  }

  return (
    <PopoverContent
      side={side}
      align="end"
      sideOffset={8}
      collisionPadding={16}
      aria-label="Bildirimler"
      className="flex max-h-[min(480px,var(--radix-popover-content-available-height))] w-[calc(100vw-32px)] flex-col overflow-hidden p-0 sm:w-[340px]"
    >
      {/* Başlık */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold">Bildirimler</h2>
          {unreadCount > 0 && (
            <Badge className="h-5 min-w-5 rounded-full px-1.5 tabular-nums">
              {unreadCount}
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onMarkAllAsRead}
            className="-mr-2 h-8 px-2 text-xs font-medium text-ink-secondary"
          >
            Tümünü okundu işaretle
          </Button>
        )}
      </div>

      {/* Liste */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && notifications.length === 0 ? (
          <ListSkeleton count={4} variant="plain" actions={0} dense />
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <BellOff className="mb-2 size-7 text-ink-muted" aria-hidden />
            <p className="text-sm text-ink-secondary">Henüz bildirim yok</p>
          </div>
        ) : (
          <ul className="divide-y">
            {notifications.map((n) => {
              const meta = notificationMeta(n.type)
              const Icon = meta.Icon
              const timeAgo = formatDistanceToNow(new Date(n.created_at), {
                addSuffix: true,
                locale: tr,
              })

              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors outline-none focus-visible:bg-muted',
                      n.is_read ? 'hover:bg-muted/70' : 'bg-brand-soft/45 hover:bg-brand-soft/70'
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] [&_svg]:size-4', ICON_TONE_CLASS[meta.tone])}
                    >
                      <Icon />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm leading-snug text-ink', n.is_read ? 'font-medium' : 'font-semibold')}>
                        {n.title}
                      </span>
                      <span className="mt-0.5 block text-xs leading-normal text-ink-secondary">
                        {humanizeIsoDates(n.message)}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[0.7rem] text-ink-muted">
                        <span>{meta.short}</span>
                        <span aria-hidden>·</span>
                        <span>{timeAgo}</span>
                      </span>
                    </span>

                    {!n.is_read && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                        <span className="sr-only">Yeni</span>
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Alt bilgi — tüm bildirimlere git */}
      <div className="shrink-0 border-t p-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-[0.8rem] text-primary"
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
