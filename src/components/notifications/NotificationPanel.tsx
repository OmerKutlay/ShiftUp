'use client'

/**
 * NotificationPanel — FAZ 10
 * Bildirim listesi dropdown paneli.
 */
import {
  Box,
  Typography,
  Popover,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Button,
  Divider,
  Chip,
  CircularProgress,
} from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import EventBusyIcon from '@mui/icons-material/EventBusy'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import BuildIcon from '@mui/icons-material/Build'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { Notification, NotificationType } from '@/types/notification'

// ─── Type icon + renk eşlemesi ─────────────────────────────────
const TYPE_META: Record<
  NotificationType,
  { icon: React.ReactNode; color: string; label: string }
> = {
  shift_reminder:     { icon: <AccessTimeIcon fontSize="small" />,       color: '#14b8a6', label: 'Vardiya' },
  leave_submitted:    { icon: <EventAvailableIcon fontSize="small" />,   color: '#60a5fa', label: 'İzin Talebi' },
  leave_approved:     { icon: <CheckCircleOutlineIcon fontSize="small" />, color: '#10b981', label: 'Onaylandı' },
  leave_rejected:     { icon: <EventBusyIcon fontSize="small" />,         color: '#ef4444', label: 'Reddedildi' },
  attendance_override:{ icon: <BuildIcon fontSize="small" />,             color: '#f59e0b', label: 'Düzeltme' },
}

interface Props {
  anchorEl: HTMLElement | null
  onClose: () => void
  notifications: Notification[]
  unreadCount: number
  loading: boolean
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
}

export function NotificationPanel({
  anchorEl,
  onClose,
  notifications,
  unreadCount,
  loading,
  onMarkAsRead,
  onMarkAllAsRead,
}: Props) {
  const router = useRouter()
  const open = Boolean(anchorEl)

  const handleItemClick = (n: Notification) => {
    if (!n.is_read) onMarkAsRead(n.id)
    onClose()
    router.push('/notifications')
  }

  const handleMarkAll = () => {
    onMarkAllAsRead()
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: {
            width: 340,
            maxHeight: 480,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'rgba(15,23,42,0.98)',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <NotificationsIcon sx={{ color: 'primary.main', fontSize: 20 }} />
          <Typography variant="subtitle2" fontWeight={700}>
            Bildirimler
          </Typography>
          {unreadCount > 0 && (
            <Chip
              label={unreadCount}
              size="small"
              sx={{
                bgcolor: 'primary.main',
                color: '#fff',
                fontWeight: 700,
                height: 18,
                fontSize: '0.7rem',
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
          )}
        </Box>
        {unreadCount > 0 && (
          <Button
            size="small"
            onClick={handleMarkAll}
            sx={{ fontSize: '0.7rem', color: 'text.secondary', minHeight: 'unset', p: 0.5 }}
          >
            Tümünü okundu işaretle
          </Button>
        )}
      </Box>

      {/* Liste */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading && notifications.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : notifications.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <WarningAmberIcon sx={{ color: 'text.secondary', opacity: 0.4, fontSize: 32, mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              Henüz bildirim yok
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {notifications.map((n, idx) => {
              const meta = TYPE_META[n.type]
              const timeAgo = formatDistanceToNow(new Date(n.created_at), {
                addSuffix: true,
                locale: tr,
              })

              return (
                <Box key={n.id}>
                  <ListItem disablePadding>
                    <ListItemButton
                      onClick={() => handleItemClick(n)}
                      sx={{
                        px: 2,
                        py: 1.25,
                        alignItems: 'flex-start',
                        gap: 1.5,
                        bgcolor: n.is_read ? 'transparent' : 'rgba(20,184,166,0.06)',
                        '&:hover': {
                          bgcolor: n.is_read
                            ? 'rgba(255,255,255,0.04)'
                            : 'rgba(20,184,166,0.1)',
                        },
                      }}
                    >
                      {/* Type icon */}
                      <Box
                        sx={{
                          flexShrink: 0,
                          mt: 0.25,
                          color: meta.color,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {meta.icon}
                      </Box>

                      {/* Content */}
                      <ListItemText
                        primary={
                          <Typography
                            variant="body2"
                            fontWeight={n.is_read ? 400 : 600}
                            color="text.primary"
                            sx={{ lineHeight: 1.4 }}
                          >
                            {n.title}
                          </Typography>
                        }
                        secondary={
                          <Box component="span" sx={{ display: 'block' }}>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              component="span"
                              sx={{ display: 'block', lineHeight: 1.5, mt: 0.25 }}
                            >
                              {n.message}
                            </Typography>
                            <Typography
                              variant="caption"
                              component="span"
                              sx={{ color: 'text.secondary', opacity: 0.6, display: 'block', mt: 0.25 }}
                            >
                              {timeAgo}
                            </Typography>
                          </Box>
                        }
                        disableTypography
                      />

                      {/* Unread dot */}
                      {!n.is_read && (
                        <Box
                          sx={{
                            flexShrink: 0,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            bgcolor: 'primary.main',
                            mt: 0.75,
                          }}
                        />
                      )}
                    </ListItemButton>
                  </ListItem>
                  {idx < notifications.length - 1 && (
                    <Divider sx={{ borderColor: 'divider', opacity: 0.5 }} />
                  )}
                </Box>
              )
            })}
          </List>
        )}
      </Box>

      {/* Footer — tüm bildirimlere git */}
      <Box
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          px: 2,
          py: 1,
          flexShrink: 0,
        }}
      >
        <Button
          fullWidth
          size="small"
          onClick={() => {
            onClose()
            router.push('/notifications')
          }}
          sx={{ color: 'primary.main', fontWeight: 600, fontSize: '0.78rem' }}
        >
          Tüm bildirimleri gör
        </Button>
      </Box>
    </Popover>
  )
}
