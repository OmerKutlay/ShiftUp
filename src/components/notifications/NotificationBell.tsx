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
import { NotificationPanel } from './NotificationPanel'
import { useNotifications } from '@/hooks/useNotifications'

/**
 * Yeni bildirimler (ör. geç/eksik okutma uyarıları) için yenileme aralığı. Acil olanlar push ile
 * anında gelir; her açık sekmenin yoklaması Worker CPU'su harcar (ücretsiz plan, 1102).
 */
const NOTIFICATION_POLL_MS = 120_000

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
        className="relative text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none font-medium text-white tabular-nums ring-2 ring-background"
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
