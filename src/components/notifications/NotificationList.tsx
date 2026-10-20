'use client'

/**
 * NotificationList — bildirim satırı (shadcn Item) ve güne göre gruplama.
 * /notifications sayfası ve zil açılır paneli aynı satırı kullanır.
 */
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { Notification } from '@/types/notification'
import { humanizeIsoDates } from '@/lib/dateUtils'
import { cn } from '@/lib/utils'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { ICON_TONE_CLASS, notificationMeta } from './notificationMeta'

export interface NotificationDayGroup {
  key: string
  label: string
  items: Notification[]
}

/** Bildirimleri gün gün gruplar: "Bugün", "Dün", "18 Ekim Pazar" (sıra korunur) */
export function groupNotificationsByDay(notifications: Notification[]): NotificationDayGroup[] {
  const groups: NotificationDayGroup[] = []
  for (const n of notifications) {
    const d = new Date(n.created_at)
    const key = Number.isNaN(d.getTime()) ? 'unknown' : format(d, 'yyyy-MM-dd')
    let g = groups.find((x) => x.key === key)
    if (!g) {
      const label = key === 'unknown' ? 'Tarihsiz'
        : isToday(d) ? 'Bugün'
          : isYesterday(d) ? 'Dün'
            : format(d, d.getFullYear() === new Date().getFullYear() ? 'd MMMM EEEE' : 'd MMMM yyyy', { locale: tr })
      g = { key, label, items: [] }
      groups.push(g)
    }
    g.items.push(n)
  }
  return groups
}

/** Bugün: "12 dakika önce"; önceki günler: saat ("14:32") — gün başlığı tarihi verir */
function whenLabel(iso: string): { short: string; full: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { short: '', full: '' }
  return {
    short: isToday(d) ? formatDistanceToNow(d, { addSuffix: true, locale: tr }) : format(d, 'HH:mm'),
    full: format(d, 'd MMMM yyyy, HH:mm', { locale: tr }),
  }
}

export function NotificationRow({ notification, onSelect, compact = false }: {
  notification: Notification
  onSelect: (n: Notification) => void
  /** Dar panel: daha sıkı dolgu, mesaj iki satırla sınırlı */
  compact?: boolean
}) {
  const meta = notificationMeta(notification.type)
  const Icon = meta.Icon
  const unread = !notification.is_read
  const when = whenLabel(notification.created_at)
  // Başlıkla aynıysa tür etiketi tekrar etmesin
  const showLabel = meta.label.toLocaleLowerCase('tr-TR') !== notification.title.toLocaleLowerCase('tr-TR')

  return (
    <Item
      asChild
      size="sm"
      className={cn(
        'w-full flex-nowrap items-start rounded-none text-left hover:bg-accent/50 focus-visible:bg-accent/50',
        compact ? 'px-4 py-3' : 'px-4 py-3.5 md:px-5'
      )}
    >
      <button type="button" onClick={() => onSelect(notification)}>
        <ItemMedia variant="icon" className={cn('size-9 rounded-md', ICON_TONE_CLASS[meta.tone])}>
          <Icon />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-0.5">
          <ItemTitle className={cn('w-full', unread ? 'font-semibold' : 'font-medium')}>
            <span className="min-w-0 flex-1">{notification.title}</span>
          </ItemTitle>
          <ItemDescription className={cn('text-pretty [overflow-wrap:anywhere]', compact ? 'line-clamp-2' : 'line-clamp-none')}>
            {humanizeIsoDates(notification.message)}
          </ItemDescription>
          <span className="mt-0.5 block text-xs text-muted-foreground" title={when.full}>
            {showLabel && <>{compact ? meta.short : meta.label} · </>}
            {when.short}
          </span>
        </ItemContent>
        <ItemActions className="self-start pt-1.5">
          {unread ? (
            <span className="size-2 rounded-full bg-primary">
              <span className="sr-only">Okunmadı</span>
            </span>
          ) : <span aria-hidden className="size-2" />}
        </ItemActions>
      </button>
    </Item>
  )
}

export function NotificationRowsSkeleton({ count = 5, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div role="status" aria-busy="true" aria-label="İçerik yükleniyor">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn('flex items-start gap-2.5', compact ? 'px-4 py-3' : 'px-4 py-3.5 md:px-5', i > 0 && 'border-t')}>
          <Skeleton className="size-9 rounded-md" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <Skeleton className="h-4" style={{ width: `${40 + ((i * 17) % 30)}%` }} />
            <Skeleton className="h-3.5 w-4/5" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
