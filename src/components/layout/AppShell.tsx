'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  IconButton,
  useMediaQuery,
  useTheme,
  Tooltip,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import LogoutIcon from '@mui/icons-material/Logout'
import LoginIcon from '@mui/icons-material/Login'

import { ErrorBoundary } from './ErrorBoundary'
import { MobileBottomNav, BOTTOM_NAV_SPACE } from './MobileBottomNav'
import { PullToRefresh } from './PullToRefresh'
import { NAV_ITEMS, SCAN_HREF, filterNavItems, isNavActive } from './navItems'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useAuth } from '@/context/AuthContext'
import { apiFetch } from '@/lib/api/http'
import { PersonAvatar } from '@/components/common/PersonAvatar'
import { BrandMark } from '@/components/common/BrandMark'
import { C, tint } from '@/lib/palette'

const DRAWER_WIDTH = 232
const DRAWER_COLLAPSED = 64
const MOBILE_BAR_HEIGHT = 56

interface Props {
  children: React.ReactNode
}

export function AppShell({ children }: Props) {
  const theme = useTheme()
  // noSsr kullanılmaz: ilk client render sunucuyla aynı (false) olmalı, aksi halde hydration mismatch oluşur
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()
  const { employee: authEmployee, signOut, status: authStatus } = useAuth()
  const authRoleName = authEmployee?.roles?.name ?? authEmployee?.role_name ?? null

  // Oturum doğrulanamadıysa (ör. geçici sunucu hatası) kullanıcı içeride sıkışmasın: giriş ekranına çıkış
  // Tam sayfa geçişi: middleware oturumu yeniden değerlendirir (geçerliyse ana sayfaya döner)
  const loginHref = `/login?next=${encodeURIComponent(pathname)}`

  const drawerWidth = collapsed && !isMobile ? DRAWER_COLLAPSED : DRAWER_WIDTH

  const narrow = collapsed && !isMobile
  const userName = authStatus === 'authenticated' && authEmployee ? authEmployee.full_name : null
  const userRole = authEmployee?.roles?.name ?? authEmployee?.role ?? ''
  // Yan menü alt başlığı: aktif mağazanın adı (yoksa genel etiket)
  const { data: store } = useSWR(
    authStatus === 'authenticated' ? '/api/store-location/name' : null,
    (url: string) => apiFetch<{ name: string | null }>(url),
    { revalidateOnFocus: false },
  )

  const drawerContent = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {/* Logo / Marka */}
      <Box
        sx={{
          px: narrow ? 1 : 2,
          pt: 2.5,
          pb: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: narrow ? 'center' : 'space-between',
          gap: 1,
        }}
      >
        {!narrow && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <BrandMark />
            <Box sx={{ minWidth: 0 }}>
              <Typography fontWeight={700} fontSize="0.95rem" lineHeight={1.2} color="text.primary">
                ShiftUp
              </Typography>
              <Typography fontSize="0.7rem" color="text.secondary" noWrap>
                {store?.name ?? 'Vardiya yönetimi'}
              </Typography>
            </Box>
          </Box>
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
      </Box>

      {/* Nav items */}
      {/* Kısa ekranlarda liste kendi içinde kayar; alttaki kullanıcı/çıkış alanı görünür kalır */}
      <List sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1, pt: 0.5 }}>
        {filterNavItems(NAV_ITEMS, authRoleName).map((item) => {
          const active = isNavActive(pathname, item.href)
          return (
            <Tooltip key={item.href} title={narrow ? item.label : ''} placement="right">
              <ListItemButton
                component={Link}
                href={item.href}
                prefetch={false}
                selected={active}
                aria-current={active ? 'page' : undefined}
                aria-label={narrow ? item.label : undefined}
                sx={{
                  borderRadius: '10px',
                  mb: 0.25,
                  minHeight: 40,
                  justifyContent: narrow ? 'center' : 'flex-start',
                  px: narrow ? 1.5 : 1.5,
                  '&:hover': { bgcolor: tint(C.ink, 0.04) },
                  '&.Mui-selected': {
                    bgcolor: 'background.paper',
                    boxShadow: `0 1px 2px ${tint(C.ink, 0.06)}`,
                    '&:hover': { bgcolor: 'background.paper' },
                  },
                  '& svg': { fontSize: 20 },
                }}
              >
                <ListItemIcon
                  sx={{
                    color: active ? 'primary.main' : 'text.secondary',
                    minWidth: narrow ? 0 : 32,
                    justifyContent: 'center',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {!narrow && (
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontSize: '0.85rem',
                      fontWeight: active ? 700 : 500,
                      color: active ? 'text.primary' : 'text.secondary',
                    }}
                  />
                )}
              </ListItemButton>
            </Tooltip>
          )
        })}
      </List>

      {/* Aktif çalışan + bildirim + çıkış */}
      <Box
        sx={{
          px: narrow ? 0.5 : 1.5,
          py: 1.5,
          display: 'flex',
          flexDirection: narrow ? 'column' : 'row',
          alignItems: 'center',
          gap: narrow ? 0.5 : 1,
        }}
      >
        {userName ? (
          <Tooltip title={narrow ? `${userName} · ${userRole}` : ''} placement="right">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: narrow ? 'none' : 1 }}>
              <PersonAvatar name={userName} size={32} />
              {!narrow && (
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontSize="0.8rem" fontWeight={700} noWrap color="text.primary">
                    {userName}
                  </Typography>
                  <Typography fontSize="0.7rem" color="text.secondary" noWrap>
                    {userRole}
                  </Typography>
                </Box>
              )}
            </Box>
          </Tooltip>
        ) : (
          !narrow && (
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
              Giriş yapılmadı
            </Typography>
          )
        )}
        <NotificationBell employeeId={authEmployee?.id ?? null} collapsed />
        {authStatus === 'authenticated' && (
          <Tooltip title="Çıkış Yap" placement={narrow ? 'right' : 'top'}>
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
        {authStatus === 'unauthenticated' && (
          <Tooltip title="Giriş Yap" placement={narrow ? 'right' : 'top'}>
            <IconButton
              size="small"
              component="a"
              href={loginHref}
              sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
              aria-label="Giriş Yap"
            >
              <LoginIcon fontSize="small" />
            </IconButton>
          </Tooltip>
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
            pl: 'calc(16px + env(safe-area-inset-left))',
            pr: 'calc(16px + env(safe-area-inset-right))',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            bgcolor: tint(C.canvas, 0.9),
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          {/* Navigasyon alt bar + /more'a taşındı; sayfa başlığı sayfanın kendisinde (PageHeader) */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
            <BrandMark size={28} />
            <Typography component="div" fontWeight={700} fontSize="1rem" color="text.primary" noWrap>
              ShiftUp
            </Typography>
          </Box>
          {/* Bildirimler her sayfadan tek dokunuşla erişilebilir olsun */}
          {authStatus === 'authenticated' && authEmployee && (
            <Box sx={{ ml: 'auto' }}>
              <NotificationBell employeeId={authEmployee.id} collapsed />
            </Box>
          )}
          {authStatus === 'unauthenticated' && (
            <IconButton
              size="small"
              component="a"
              href={loginHref}
              sx={{ ml: 'auto', color: 'text.secondary' }}
              aria-label="Giriş Yap"
            >
              <LoginIcon fontSize="small" />
            </IconButton>
          )}
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

      {/* Mobil alt sekme çubuğu */}
      {isMobile && <MobileBottomNav />}

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
          // Alt bar içeriği örtmesin: bar yüksekliği + body'nin safe-area-inset-bottom padding'i
          // birlikte barın (64px + safe-area) kapladığı alanı karşılar
          pb: isMobile ? `${BOTTOM_NAV_SPACE}px` : 0,
          // Masaüstü: içerik krem zemin üstünde beyaz, yuvarlak köşeli panelde
          ...(!isMobile && { py: 1.5, pr: 1.5 }),
        }}
      >
        <Box
          sx={isMobile ? undefined : {
            minHeight: 'calc(100dvh - 24px)',
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '20px',
            overflow: 'clip',
          }}
        >
        {/* Ağaç her boyutta aynı kalsın (breakpoint değişince sayfa state'i sıfırlanmasın);
            yalnızca mobilde etkin, QR tarayıcıda kamera akışıyla çakışmasın diye kapalı */}
        <PullToRefresh disabled={!isMobile || isNavActive(pathname, SCAN_HREF)}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </PullToRefresh>
        </Box>
      </Box>
    </Box>
  )
}

