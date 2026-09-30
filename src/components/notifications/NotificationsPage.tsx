'use client'

/**
 * NotificationsPage — FAZ 10
 * /notifications sayfası için tam liste görünümü.
 */
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Button,
  Divider,
  Chip,
  CircularProgress,
  Paper,
  Alert,
} from '@mui/material'
import NotificationsIcon from '@mui/icons-material/Notifications'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import EventAvailableIcon from '@mui/icons-material/EventAvailableOutlined'
import EventBusyIcon from '@mui/icons-material/EventBusyOutlined'
import BuildIcon from '@mui/icons-material/Build'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { formatDistanceToNow, format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useNotifications } from '@/hooks/useNotifications'
import type { Notification, NotificationType } from '@/types/notification'

// Demo employee ID — auth entegrasyonu sonrası session'dan okunacak
const DEMO_EMPLOYEE_ID = null as string | null

const TYPE_META: Record<
  NotificationType,
  { icon: React.ReactNode; color: string; label: string }
> = {
  shift_reminder:     { icon: <AccessTimeIcon />,           color: '#14b8a6', label: 'Vardiya Hatırlatması' },
  leave_submitted:    { icon: <EventAvailableIcon />,        color: '#60a5fa', label: 'İzin Talebi' },
  leave_approved:     { icon: <CheckCircleOutlineIcon />,    color: '#10b981', label: 'İzin Onaylandı' },
  leave_rejected:     { icon: <EventBusyIcon />,             color: '#ef4444', label: 'İzin Reddedildi' },
  attendance_override:{ icon: <BuildIcon />,                 color: '#f59e0b', label: 'Devam Düzeltmesi' },
}

function NotificationItem({
  notification,
  onMarkAsRead,
}: {
  notification: Notification
  onMarkAsRead: (id: string) => void
}) {
  const meta = TYPE_META[notification.type]
  const timeAgo = formatDistanceToNow(new Date(notification.created_at), {
    addSuffix: true,
    locale: tr,
  })
  const fullDate = format(new Date(notification.created_at), 'd MMM yyyy, HH:mm', { locale: tr })

  return (
    <ListItem disablePadding>
      <ListItemButton
        onClick={() => {
          if (!notification.is_read) onMarkAsRead(notification.id)
        }}
        sx={{
          px: 2.5,
          py: 1.75,
          alignItems: 'flex-start',
          gap: 2,
          bgcolor: notification.is_read ? 'transparent' : 'rgba(20,184,166,0.06)',
          borderRadius: 1,
          '&:hover': {
            bgcolor: notification.is_read
              ? 'rgba(255,255,255,0.04)'
              : 'rgba(20,184,166,0.1)',
          },
        }}
      >
        {/* Tip ikonu */}
        <Box
          sx={{
            flexShrink: 0,
            mt: 0.5,
            color: meta.color,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {meta.icon}
        </Box>

        {/* İçerik */}
        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography
                variant="body2"
                fontWeight={notification.is_read ? 400 : 700}
                color="text.primary"
              >
                {notification.title}
              </Typography>
              <Chip
                label={meta.label}
                size="small"
                sx={{
                  bgcolor: `${meta.color}22`,
                  color: meta.color,
                  fontWeight: 600,
                  fontSize: '0.65rem',
                  height: 18,
                  '& .MuiChip-label': { px: 0.75 },
                }}
              />
              {!notification.is_read && (
                <Chip
                  label="Yeni"
                  size="small"
                  sx={{
                    bgcolor: 'primary.main',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.65rem',
                    height: 18,
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              )}
            </Box>
          }
          secondary={
            <Box component="span" sx={{ display: 'block' }}>
              <Typography variant="body2" color="text.secondary" component="span" sx={{ display: 'block', mt: 0.5 }}>
                {notification.message}
              </Typography>
              <Typography
                variant="caption"
                component="span"
                sx={{ color: 'text.secondary', opacity: 0.6, display: 'block', mt: 0.5 }}
                title={fullDate}
              >
                {timeAgo}
              </Typography>
            </Box>
          }
          disableTypography
        />
      </ListItemButton>
    </ListItem>
  )
}

export function NotificationsPage() {
  const { notifications, unreadCount, loading, error, markAsRead, markAllAsRead, refresh } =
    useNotifications(DEMO_EMPLOYEE_ID)

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 720, mx: 'auto' }}>
      {/* Başlık */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <NotificationsIcon sx={{ color: 'primary.main', fontSize: 28 }} />
          <Typography variant="h6" fontWeight={800}>
            Bildirimler
          </Typography>
          {unreadCount > 0 && (
            <Chip
              label={`${unreadCount} okunmamış`}
              size="small"
              sx={{ bgcolor: 'primary.main', color: '#fff', fontWeight: 700 }}
            />
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {unreadCount > 0 && (
            <Button
              size="small"
              variant="outlined"
              onClick={markAllAsRead}
              sx={{ borderColor: 'divider', color: 'text.secondary', fontSize: '0.78rem' }}
            >
              Tümünü okundu işaretle
            </Button>
          )}
          <Button
            size="small"
            variant="outlined"
            onClick={refresh}
            sx={{ borderColor: 'divider', color: 'text.secondary', fontSize: '0.78rem' }}
          >
            Yenile
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper
        sx={{
          bgcolor: 'rgba(30,41,59,0.6)',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        {loading && notifications.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={32} />
          </Box>
        ) : notifications.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <WarningAmberIcon sx={{ color: 'text.secondary', opacity: 0.3, fontSize: 48, mb: 1 }} />
            <Typography variant="body1" color="text.secondary">
              Henüz bildirim bulunmuyor
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.7 }}>
              Vardiya hatırlatmaları ve izin bildirimleri burada görünecek
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {notifications.map((n, idx) => (
              <Box key={n.id}>
                <NotificationItem notification={n} onMarkAsRead={markAsRead} />
                {idx < notifications.length - 1 && (
                  <Divider sx={{ borderColor: 'divider', opacity: 0.4, mx: 2 }} />
                )}
              </Box>
            ))}
          </List>
        )}
      </Paper>

      {!DEMO_EMPLOYEE_ID && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Bildirimler auth entegrasyonu tamamlandığında aktif çalışana göre filtrelenecek.
          Şu an geliştirme modunda çalışıyor.
        </Alert>
      )}
    </Box>
  )
}
