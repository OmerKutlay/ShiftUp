'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
import PersonIcon from '@mui/icons-material/Person'
import LogoutIcon from '@mui/icons-material/Logout'
import GroupsIcon from '@mui/icons-material/Groups'
import WorkIcon from '@mui/icons-material/Work'
import EventNoteIcon from '@mui/icons-material/EventNote'
import EditNoteIcon from '@mui/icons-material/EditNote'

import { ErrorBoundary } from './ErrorBoundary'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES, ADMIN_ROLES } from '@/lib/auth/roles'

const DRAWER_WIDTH = 220
const DRAWER_COLLAPSED = 64
const MOBILE_BAR_HEIGHT = 56

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  /** Bu nav item yalnızca belirtilen rollere gösterilir. Undefined = herkese. */
  requiredRoles?: string[]
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Genel Bakış',       href: '/dashboard',       icon: <DashboardIcon />,     requiredRoles: MANAGER_ROLES },
  { label: 'Günlük Operasyon',  href: '/',                icon: <TodayIcon />,         requiredRoles: MANAGER_ROLES },
  { label: 'Çalışanlar',        href: '/employees',       icon: <PeopleIcon />,        requiredRoles: MANAGER_ROLES },
  { label: 'Vardiya Şablonları',href: '/shift-templates', icon: <ScheduleIcon />,      requiredRoles: MANAGER_ROLES },
  { label: 'Haftalık Plan',     href: '/schedule',        icon: <CalendarMonthIcon /> },
  { label: 'QR Kiosk',          href: '/qr-kiosk',        icon: <QrCode2Icon />,       requiredRoles: MANAGER_ROLES },
  { label: 'QR Tara',           href: '/attendance/scan', icon: <QrCodeScannerIcon /> },
  { label: 'Çalışma Özetim',   href: '/my-schedule',     icon: <EventNoteIcon /> },
  { label: 'Açık Vardiyalar',   href: '/open-shifts',     icon: <WorkIcon /> },
  { label: 'İzin Talepleri',    href: '/leave',           icon: <BeachAccessIcon /> },
  { label: 'Mesai Düzeltme',   href: '/time-correction', icon: <EditNoteIcon /> },
  { label: 'İş Gücü',           href: '/workforce',       icon: <GroupsIcon />,        requiredRoles: MANAGER_ROLES },
  { label: 'Raporlar',          href: '/reports',         icon: <BarChartIcon />,      requiredRoles: MANAGER_ROLES },
  { label: 'Ayarlar',           href: '/settings',        icon: <SettingsIcon />,      requiredRoles: ADMIN_ROLES },
]

interface Props {
  children: React.ReactNode
}

export function AppShell({ children }: Props) {
  const theme = useTheme()
  // noSsr kullanılmaz: ilk client render sunucuyla aynı (false) olmalı, aksi halde hydration mismatch oluşur
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const { employee: authEmployee, signOut, status: authStatus } = useAuth()
  const authRoleName = authEmployee?.roles?.name ?? authEmployee?.role_name ?? null

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
            aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
            aria-expanded={!collapsed}
            sx={{ color: 'text.secondary' }}
          >
            {collapsed ? <MenuIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
          </IconButton>
        )}
        {isMobile && (
          <IconButton
            size="small"
            onClick={() => setMobileOpen(false)}
            aria-label="Menüyü kapat"
            sx={{ color: 'text.secondary' }}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Divider sx={{ borderColor: 'divider' }} />

      {/* Nav items */}
      {/* Kısa ekranlarda liste kendi içinde kayar; alttaki kullanıcı/çıkış alanı görünür kalır */}
      <List sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1, pt: 1 }}>
        {NAV_ITEMS.filter((item) =>
          !item.requiredRoles || hasRole(authRoleName, item.requiredRoles as never)
        ).map((item) => {
          const active = pathname === item.href
          return (
            <Tooltip
              key={item.href}
              title={collapsed && !isMobile ? item.label : ''}
              placement="right"
            >
              <ListItemButton
                component={Link}
                href={item.href}
                prefetch={false}
                onClick={() => {
                  if (isMobile) setMobileOpen(false)
                }}
                selected={active}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed && !isMobile ? item.label : undefined}
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

      <Divider sx={{ borderColor: 'divider' }} />

      {/* Aktif çalışan + bildirim */}
      <Box sx={{ px: collapsed && !isMobile ? 0.5 : 1.5, py: 1.25 }}>
        {(!collapsed || isMobile) ? (
          <>
            {/* Auth bilgisi */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
              <PersonIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
              <Typography variant="caption" color="text.secondary" fontWeight={500} noWrap sx={{ flex: 1 }}>
                {authStatus === 'authenticated' && authEmployee
                  ? authEmployee.full_name
                  : 'Giriş yapılmadı'}
              </Typography>
            </Box>
            {authStatus === 'authenticated' && authEmployee && (
              <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block', mb: 0.75, pl: 2.75 }}>
                {authEmployee.roles?.name ?? authEmployee.role}
              </Typography>
            )}
            {/* Bildirim + logout satırı */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <NotificationBell
                employeeId={authEmployee?.id ?? null}
                collapsed={false}
              />
              {authStatus === 'authenticated' && (
                <Tooltip title="Çıkış Yap">
                  <IconButton
                    size="small"
                    onClick={signOut}
                    sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                    aria-label="Çıkış Yap"
                  >
                    <LogoutIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </>
        ) : (
          /* Collapsed: bildirim ikonu + logout */
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            <NotificationBell
              employeeId={authEmployee?.id ?? null}
              collapsed={true}
            />
            {authStatus === 'authenticated' && (
              <Tooltip title="Çıkış Yap" placement="right">
                <IconButton
                  size="small"
                  onClick={signOut}
                  sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                  aria-label="Çıkış Yap"
                >
                  <LogoutIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
      {/* Mobile top bar — içerik üzerinde yüzen buton yerine sabit, markalı bar */}
      {isMobile && (
        <Box
          component="header"
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: theme.zIndex.appBar,
            height: `calc(${MOBILE_BAR_HEIGHT}px + env(safe-area-inset-top))`,
            pt: 'env(safe-area-inset-top)',
            pl: 'calc(8px + env(safe-area-inset-left))',
            pr: 'calc(16px + env(safe-area-inset-right))',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: 'rgba(15,23,42,0.85)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <IconButton
            onClick={() => setMobileOpen(true)}
            aria-label="Menüyü aç"
            sx={{ color: 'text.primary', WebkitTapHighlightColor: 'transparent' }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="subtitle1" fontWeight={800} color="primary.main" letterSpacing={1}>
            ShiftUp
          </Typography>
        </Box>
      )}

      {/* Desktop drawer */}
      {!isMobile && (
        <Box
          component="nav"
          aria-label="Ana menü"
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
          // Sol boşluk masaüstünde nav yer tutucusundan gelir; ek margin çift boşluk yaratır
          flex: 1,
          minWidth: 0,
          minHeight: '100dvh',
          // body zaten safe-area-inset-top kadar padding alıyor; burada yalnızca bar yüksekliği eklenir
          pt: isMobile ? `${MOBILE_BAR_HEIGHT}px` : 0,
        }}
      >
        <ErrorBoundary>{children}</ErrorBoundary>
      </Box>
    </Box>
  )
}
