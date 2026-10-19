'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { usePathname } from 'next/navigation'


import { ErrorBoundary } from './ErrorBoundary'
import { MobileBottomNav, BOTTOM_NAV_SPACE } from './MobileBottomNav'
import { PullToRefresh } from './PullToRefresh'
import { NAV_ITEMS, SCAN_HREF, filterNavItems, isNavActive } from './navItems'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useAuth } from '@/context/AuthContext'
import { apiFetch } from '@/lib/api/http'
import { PersonAvatar } from '@/components/common/PersonAvatar'
import { BrandMark } from '@/components/common/BrandMark'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'

const DRAWER_WIDTH = 232
const DRAWER_COLLAPSED = 64
const MOBILE_BAR_HEIGHT = 56

interface Props {
  children: React.ReactNode
}

export function AppShell({ children }: Props) {
  // İlk client render sunucuyla aynı (false) olmalı, aksi halde hydration mismatch oluşur
  const isMobile = useIsMobile()
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

  /** Daraltılmış menüde etiketin yerine ipucu */
  const withTip = (label: string, node: React.ReactElement) =>
    narrow ? (
      <Tooltip>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    ) : node

  const drawerContent = (
    <div className="flex h-full flex-col bg-background">
      {/* Logo / Marka */}
      <div className={cn('flex items-center gap-2 pt-5 pb-4', narrow ? 'justify-center px-2' : 'justify-between px-4')}>
        {!narrow && (
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark />
            <div className="min-w-0">
              <p className="text-[0.95rem] font-bold leading-tight">ShiftUp</p>
              <p className="truncate text-[0.7rem] text-ink-secondary">{store?.name ?? 'Vardiya yönetimi'}</p>
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
          aria-expanded={!collapsed}
          className="text-ink-secondary"
        >
          {collapsed ? <PanelLeftOpen /> : <ChevronsLeft />}
        </Button>
      </div>

      {/* Menü — kısa ekranlarda liste kendi içinde kayar; alttaki kullanıcı alanı görünür kalır */}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pt-1">
        {filterNavItems(NAV_ITEMS, authRoleName).map((item) => {
          const active = isNavActive(pathname, item.href)
          return (
            <li key={item.href}>
              {withTip(
                item.label,
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={active ? 'page' : undefined}
                  aria-label={narrow ? item.label : undefined}
                  className={cn(
                    'flex h-10 items-center gap-2.5 rounded-[10px] text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-[18px] [&_svg]:shrink-0',
                    narrow ? 'justify-center px-0' : 'px-3',
                    active
                      ? 'bg-card font-bold text-ink shadow-[0_1px_2px_rgb(43_33_27/0.06)] [&_svg]:text-primary'
                      : 'font-medium text-ink-secondary hover:bg-ink/[0.04] hover:text-ink'
                  )}
                >
                  {item.icon}
                  {!narrow && <span className="truncate">{item.label}</span>}
                </Link>
              )}
            </li>
          )
        })}
      </ul>

      {/* Aktif çalışan + bildirim + çıkış */}
      <div className={cn('flex items-center gap-1.5 py-3', narrow ? 'flex-col px-1' : 'px-3')}>
        {userName ? (
          withTip(
            `${userName} · ${userRole}`,
            <div className={cn('flex min-w-0 items-center gap-2', !narrow && 'flex-1')}>
              <PersonAvatar name={userName} size={32} />
              {!narrow && (
                <div className="min-w-0">
                  <p className="truncate text-[0.8rem] font-bold">{userName}</p>
                  <p className="truncate text-[0.7rem] text-ink-secondary">{userRole}</p>
                </div>
              )}
            </div>
          )
        ) : (
          !narrow && <p className="flex-1 text-xs text-ink-secondary">Giriş yapılmadı</p>
        )}
        <NotificationBell employeeId={authEmployee?.id ?? null} collapsed />
        {authStatus === 'authenticated' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={signOut} aria-label="Çıkış Yap" className="text-ink-secondary hover:text-danger">
                <LogOut />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={narrow ? 'right' : 'top'}>Çıkış Yap</TooltipContent>
          </Tooltip>
        )}

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Mobil üst bar — opak: kayan içerik arkada bulanık görünmesin */}
      {isMobile && (
        <header
          className="fixed inset-x-0 top-0 z-[1100] flex h-[calc(56px+env(safe-area-inset-top))] items-center gap-2 border-b bg-background pt-[env(safe-area-inset-top)] pr-[calc(16px+env(safe-area-inset-right))] pl-[calc(16px+env(safe-area-inset-left))] select-none"
        >
          {/* Navigasyon alt bar + /more'a taşındı; sayfa başlığı sayfanın kendisinde (PageHeader) */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <BrandMark size={28} />
            <span className="truncate font-bold">ShiftUp</span>
          </div>
          {/* Bildirimler her sayfadan tek dokunuşla erişilebilir olsun */}
          {authStatus === 'authenticated' && authEmployee && (
            <NotificationBell employeeId={authEmployee.id} collapsed />
          )}

      )}

      {/* Masaüstü yan menü */}
      {!isMobile && (
        <nav aria-label="Ana menü" className="shrink-0 transition-[width] duration-200" style={{ width: drawerWidth }}>
          <div className="fixed top-0 left-0 h-dvh overflow-hidden transition-[width] duration-200" style={{ width: drawerWidth }}>
            {drawerContent}
          </div>
        </nav>
      )}

      {/* Mobil alt sekme çubuğu */}
      {isMobile && <MobileBottomNav />}

      {/* İçerik — mobilde üst / alt bar kadar boşluk (body safe-area padding'i alır);
          masaüstünde krem zemin üstünde beyaz, yuvarlak köşeli panel */}
      <main
        className={cn('min-h-dvh min-w-0 flex-1', !isMobile && 'py-3 pr-3')}
        style={isMobile ? { paddingTop: MOBILE_BAR_HEIGHT, paddingBottom: BOTTOM_NAV_SPACE } : undefined}
      >
        <div className={cn(!isMobile && 'min-h-[calc(100dvh-24px)] overflow-clip rounded-[20px] border bg-card')}>
          {/* Ağaç her boyutta aynı kalsın (breakpoint değişince sayfa state'i sıfırlanmasın);
              yalnızca mobilde etkin, QR tarayıcıda kamera akışıyla çakışmasın diye kapalı */}
          <PullToRefresh disabled={!isMobile || isNavActive(pathname, SCAN_HREF)}>
            <ErrorBoundary>{children}</ErrorBoundary>
          </PullToRefresh>
        </div>
      </main>
    </div>
  )
}
