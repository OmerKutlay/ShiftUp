'use client'

/**
 * NotificationBell — FAZ 10
 * Sidebar'a veya herhangi bir alana yerleştirilecek bildirim ikonu + badge.
 */
import { useState } from 'react'
import { Badge, IconButton, Tooltip } from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
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
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } =
    useNotifications(employeeId, NOTIFICATION_POLL_MS)

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget)
  }
  const handleClose = () => setAnchorEl(null)

  return (
    <>
      <Tooltip title={collapsed ? 'Bildirimler' : ''} placement="right">
        <IconButton
          onClick={handleOpen}
          size="small"
          aria-label={`Bildirimler${unreadCount > 0 ? `, ${unreadCount} okunmamış` : ''}`}
          sx={{
            color: unreadCount > 0 ? 'primary.main' : 'text.secondary',
            transition: 'color 0.2s',
          }}
        >
          <Badge
            badgeContent={unreadCount}
            max={99}
            color="error"
            invisible={unreadCount === 0}
            sx={{
              '& .MuiBadge-badge': {
                fontSize: '0.65rem',
                minWidth: 16,
                height: 16,
                padding: '0 4px',
              },
            }}
          >
            <NotificationsIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>

      <NotificationPanel
        anchorEl={anchorEl}
        onClose={handleClose}
        notifications={notifications}
        unreadCount={unreadCount}
        loading={loading}
        onMarkAsRead={markAsRead}
        onMarkAllAsRead={markAllAsRead}
      />
    </>
  )
}
