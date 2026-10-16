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
import PersonIcon from '@mui/icons-material/Person'
import { formatDistanceToNow, format } from 'date-fns'
import { tr } from 'date-fns/locale'
import { useNotifications } from '@/hooks/useNotifications'
import { useAuth } from '@/context/AuthContext'
import { PageHeader, ListSkeleton } from '@/components/common'
import type { Notification, NotificationType } from '@/types/notification'
import { humanizeIsoDates } from '@/lib/dateUtils'
import { notificationLink } from '@/lib/notificationLinks'
import { PushPermissionCard } from '@/components/pwa/PushPermissionCard'
import { useRouter } from 'next/navigation'

const TYPE_META: Record<
  NotificationType,
  { icon: React.ReactNode; color: string; label: string }
> = {
  shift_reminder:      { icon: <AccessTimeIcon />,            color: '#14b8a6', label: 'Vardiya Hatırlatması' },
  leave_submitted:     { icon: <EventAvailableIcon />,         color: '#60a5fa', label: 'İzin Talebi' },
  leave_approved:      { icon: <CheckCircleOutlineIcon />,     color: '#10b981', label: 'İzin Onaylandı' },
  leave_rejected:      { icon: <EventBusyIcon />,              color: '#ef4444', label: 'İzin Reddedildi' },
  attendance_override: { icon: <BuildIcon />,                  color: '#f59e0b', label: 'Devam Düzeltmesi' },
  open_shift_available:{ icon: <EventAvailableIcon />,         color: '#a78bfa', label: 'Açık Vardiya' },
  time_correction_submitted: { icon: <AccessTimeIcon />,       color: '#60a5fa', label: 'Mesai Talebi' },
  time_correction_approved:  { icon: <CheckCircleOutlineIcon />, color: '#10b981', label: 'Mesai Onaylandı' },
  time_correction_rejected:  { icon: <EventBusyIcon />,        color: '#ef4444', label: 'Mesai Reddedildi' },
  shift_swap_submitted:      { icon: <AccessTimeIcon />,       color: '#60a5fa', label: 'Takas Talebi' },
  shift_swap_approved:       { icon: <CheckCircleOutlineIcon />, color: '#10b981', label: 'Takas Onaylandı' },
  shift_swap_rejected:       { icon: <EventBusyIcon />,        color: '#ef4444', label: 'Takas Reddedildi' },
  open_shift_claimed:        { icon: <EventAvailableIcon />,   color: '#a78bfa', label: 'Açık Vardiya Alındı' },
  attendance_late_clock_in:  { icon: <WarningAmberIcon />,     color: '#f59e0b', label: 'Geç Giriş' },
  attendance_late_clock_out: { icon: <WarningAmberIcon />,     color: '#f59e0b', label: 'Geç Çıkış' },
  attendance_missed_clock_in:  { icon: <WarningAmberIcon />,   color: '#ef4444', label: 'Giriş Okutulmadı' },
  attendance_missed_clock_out: { icon: <WarningAmberIcon />,   color: '#ef4444', label: 'Çıkış Okutulmadı' },
}

function NotificationItem({
  notification,
  onMarkAsRead,
}: {
  notification: Notification
  onMarkAsRead: (id: string) => void
}) {
  const router = useRouter()
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
          // İlgili sayfaya git (hedef bildirimler sayfasıysa yalnızca okundu işaretlenir)
          const href = notificationLink(notification.type)
          if (href !== '/notifications') router.push(href)
        }}
        sx={{
          px: 2.5,
          py: 1.75,
          alignItems: 'flex-start',
          gap: 2,
          bgcolor: notification.is_read ? 'transparent' : 'rgba(20,184,166,0.06)',
          borderRadius: 1,
          '&:hover': {
            bgcolor: notification.is_read ? 'rgba(255,255,255,0.04)' : 'rgba(20,184,166,0.1)',
          },
        }}
      >
        <Box sx={{ flexShrink: 0, mt: 0.5, color: meta.color, display: 'flex', alignItems: 'center' }}>
          {meta.icon}
        </Box>

        <ListItemText
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" fontWeight={notification.is_read ? 400 : 700} color="text.primary">
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
                {humanizeIsoDates(notification.message)}
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
  const { employee: authEmployee, status: authStatus } = useAuth()
  const { notifications, unreadCount, isFirstLoad, error, markAsRead, markAllAsRead, refresh } =
    useNotifications(authEmployee?.id ?? null)

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 720, mx: 'auto' }}>
      <PageHeader
        icon={NotificationsIcon}
        overline="Gelen Kutusu"
        title="Bildirimler"
        titleAdornment={
          unreadCount > 0 && (
            <Chip
              label={`${unreadCount} okunmamış`}
              size="small"
              sx={{ bgcolor: 'primary.main', color: '#fff', fontWeight: 700 }}
            />
          )
        }
        subtitle={
          authEmployee && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <PersonIcon sx={{ fontSize: 14 }} />
              {authEmployee.full_name}
            </Box>
          )
        }
        actions={
          <>
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
          </>
        }
      />

      {authEmployee && <PushPermissionCard />}

      {authStatus === 'unauthenticated' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Bildirimleri görmek için giriş yapmanız gerekiyor.
        </Alert>
      )}

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
        {authStatus === 'loading' || (authEmployee && isFirstLoad) ? (
          <ListSkeleton count={6} variant="plain" actions={0} />
        ) : notifications.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <NotificationsIcon sx={{ color: 'text.secondary', opacity: 0.3, fontSize: 48, mb: 1 }} />
            <Typography variant="body1" color="text.secondary">
              {authEmployee ? 'Henüz bildirim bulunmuyor' : 'Giriş yapılmadı'}
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
    </Box>
  )
}
