'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  IconButton,
  useMediaQuery,
  useTheme,
  Divider,
  Tooltip,
} from '@mui/material'
import TodayIcon from '@mui/icons-material/Today'
import PeopleIcon from '@mui/icons-material/People'
import ScheduleIcon from '@mui/icons-material/Schedule'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner'
import BarChartIcon from '@mui/icons-material/BarChart'
import BeachAccessIcon from '@mui/icons-material/BeachAccess'
import DashboardIcon from '@mui/icons-material/Dashboard'
import SettingsIcon from '@mui/icons-material/Settings'
import MenuIcon from '@mui/icons-material/Menu'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'

import { ErrorBoundary } from './ErrorBoundary'
import { NotificationBell } from '@/components/notifications/NotificationBell'

// Demo: mevcut auth yokken ilk aktif çalışan ID'si kullanılır.
// Gerçek auth entegrasyonu yapıldığında burası session'dan okunacak.
const DEMO_EMPLOYEE_ID = null as string | null

const DRAWER_WIDTH = 220
const DRAWER_COLLAPSED = 64

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Genel Bakış', href: '/dashboard', icon: <DashboardIcon /> },
  { label: 'Günlük Operasyon', href: '/', icon: <TodayIcon /> },
  { label: 'Çalışanlar', href: '/employees', icon: <PeopleIcon /> },
  { label: 'Vardiya Şablonları', href: '/shift-templates', icon: <ScheduleIcon /> },
  { label: 'Haftalık Plan', href: '/schedule', icon: <CalendarMonthIcon /> },
  { label: 'QR Kiosk', href: '/qr-kiosk', icon: <QrCode2Icon /> },
  { label: 'QR Tara', href: '/attendance/scan', icon: <QrCodeScannerIcon /> },
  { label: 'İzin Talepleri', href: '/leave', icon: <BeachAccessIcon /> },
  { label: 'Raporlar', href: '/reports', icon: <BarChartIcon /> },
  { label: 'Ayarlar', href: '/settings', icon: <SettingsIcon /> },
]

interface Props {
  children: React.ReactNode
}

export function AppShell({ children }: Props) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const drawerWidth = collapsed && !isMobile ? DRAWER_COLLAPSED : DRAWER_WIDTH

  const drawerContent = (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'rgba(15,23,42,0.98)',
        borderRight: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Logo / Brand */}
      <Box
        sx={{
          px: collapsed && !isMobile ? 1 : 2,
          py: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed && !isMobile ? 'center' : 'space-between',
          minHeight: 56,
        }}
      >
        {(!collapsed || isMobile) && (
          <Typography
            variant="subtitle1"
            fontWeight={800}
            color="primary.main"
            letterSpacing={1}
          >
            ShiftUp
          </Typography>
        )}
        {!isMobile && (
          <IconButton
            size="small"
            onClick={() => setCollapsed((c) => !c)}
            sx={{ color: 'text.secondary' }}
          >
            {collapsed ? <MenuIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
          </IconButton>
        )}
        {isMobile && (
          <IconButton
            size="small"
            onClick={() => setMobileOpen(false)}
            sx={{ color: 'text.secondary' }}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Divider sx={{ borderColor: 'divider' }} />

      {/* Nav items */}
      <List sx={{ flex: 1, px: 1, pt: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href
          return (
            <Tooltip
              key={item.href}
              title={collapsed && !isMobile ? item.label : ''}
              placement="right"
            >
              <ListItemButton
                onClick={() => {
                  router.push(item.href)
                  if (isMobile) setMobileOpen(false)
                }}
                selected={active}
                sx={{
                  borderRadius: 2,
                  mb: 0.5,
                  minHeight: 44,
                  justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
                  px: collapsed && !isMobile ? 1.5 : 2,
                  '&.Mui-selected': {
                    bgcolor: 'rgba(20,184,166,0.12)',
                    '&:hover': { bgcolor: 'rgba(20,184,166,0.18)' },
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    color: active ? 'primary.main' : 'text.secondary',
                    minWidth: collapsed && !isMobile ? 0 : 36,
                    justifyContent: 'center',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {(!collapsed || isMobile) && (
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontSize: '0.85rem',
                      fontWeight: active ? 700 : 500,
                      color: active ? 'primary.main' : 'text.secondary',
                    }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          )
        })}
      </List>

      {/* Bildirim alanı — sidebar alt kısmı */}
      <Divider sx={{ borderColor: 'divider' }} />
      <Box
        sx={{
          px: collapsed && !isMobile ? 1 : 2,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed && !isMobile ? 'center' : 'space-between',
          minHeight: 52,
        }}
      >
        {(!collapsed || isMobile) && (
          <Typography variant="caption" color="text.secondary" fontWeight={500}>
            Bildirimler
          </Typography>
        )}
        <NotificationBell
          employeeId={DEMO_EMPLOYEE_ID}
          collapsed={collapsed && !isMobile}
        />
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
      {/* Mobile hamburger */}
      {isMobile && (
        <IconButton
          onClick={() => setMobileOpen(true)}
          sx={{
            position: 'fixed',
            // safe-area-inset-top: iOS notch altına yerleşir
            top: 'calc(12px + env(safe-area-inset-top))',
            left: 'calc(12px + env(safe-area-inset-left))',
            zIndex: 1300,
            bgcolor: 'rgba(30,41,59,0.9)',
            border: '1px solid',
            borderColor: 'divider',
            color: 'text.primary',
            WebkitTapHighlightColor: 'transparent',
          }}
          // size prop'u kaldırıldı → theme override ile 44×44 garantili
        >
          <MenuIcon />
        </IconButton>
      )}

      {/* Desktop drawer */}
      {!isMobile && (
        <Box
          component="nav"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            transition: 'width 0.2s',
          }}
        >
          <Box
            sx={{
              width: drawerWidth,
              position: 'fixed',
              top: 0,
              left: 0,
              height: '100dvh',
              transition: 'width 0.2s',
              overflow: 'hidden',
            }}
          >
            {drawerContent}
          </Box>
        </Box>
      )}

      {/* Mobile drawer */}
      {isMobile && (
        <Drawer
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{
            sx: { width: DRAWER_WIDTH, bgcolor: 'transparent' },
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flex: 1,
          minWidth: 0,
          ml: isMobile ? 0 : `${drawerWidth}px`,
          transition: 'margin-left 0.2s',
          minHeight: '100dvh',
          // Mobile: hamburger button (44px) + safe-area-inset-top kadar boşluk
          pt: isMobile ? 'calc(68px + env(safe-area-inset-top))' : 0,
        }}
      >
        <ErrorBoundary>{children}</ErrorBoundary>
      </Box>
    </Box>
  )
}
