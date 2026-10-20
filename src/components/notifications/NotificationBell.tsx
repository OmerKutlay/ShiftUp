'use client'

/**
 * NotificationBell — FAZ 10
 * Sidebar'a veya herhangi bir alana yerleştirilecek bildirim ikonu + sayaç.
 */
import { useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'
import { NotificationPanel } from './NotificationPanel'
import { useNotifications } from '@/hooks/useNotifications'

/** Yeni bildirimler (ör. geç/eksik okutma uyarıları) için yenileme aralığı */
const NOTIFICATION_POLL_MS = 60_000

interface Props {
  employeeId: string | null
  /** collapsed sidebar modunda icon-only gösterim */
  collapsed?: boolean
}

export function NotificationBell({ employeeId, collapsed = false }: Props) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } =
    useNotifications(employeeId, NOTIFICATION_POLL_MS)

  const trigger = (
    <PopoverTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Bildirimler${unreadCount > 0 ? `, ${unreadCount} okunmamış` : ''}`}
        className={cn('relative rounded-xl', unreadCount > 0 ? 'text-primary' : 'text-ink-secondary')}
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.62rem] leading-none font-bold text-white ring-2 ring-background"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>
    </PopoverTrigger>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {collapsed && !isMobile ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">Bildirimler</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}

      <NotificationPanel
        // Telefonda zil üst çubuğun sağında: panel zilin altına, sağa hizalı açılsın (üstünü kapatmasın)
        side={isMobile ? 'bottom' : 'right'}
        onClose={() => setOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        loading={loading}
        onMarkAsRead={markAsRead}
        onMarkAllAsRead={markAllAsRead}
      />
    </Popover>
  )
}
