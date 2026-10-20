'use client'

/**
 * AppShell — uygulama kabuğu.
 *   Masaüstü (≥ md): shadcn Sidebar (inset) + SiteHeader + içerik paneli
 *   Mobil (< md):    sabit opak üst bar + alt sekme çubuğu; içerik ikisinin arasında kayar
 * Ağaç her boyutta aynı yapıda kalır (kırılım değişince sayfa state'i sıfırlanmasın).
 */
import { usePathname } from 'next/navigation'

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useIsMobile } from '@/hooks/useIsMobile'
import { ErrorBoundary } from './ErrorBoundary'
import { AppSidebar } from './AppSidebar'
import { SiteHeader } from './SiteHeader'
import { MobileTopBar, MOBILE_TOP_BAR_HEIGHT } from './MobileTopBar'
import { MobileBottomNav, BOTTOM_NAV_SPACE } from './MobileBottomNav'
import { PullToRefresh } from './PullToRefresh'
import { SCAN_HREF, isNavActive } from './navItems'

export function AppShell({ children }: { children: React.ReactNode }) {
  // İlk client render sunucuyla aynı (false) olmalı, aksi halde hydration mismatch oluşur
  const isMobile = useIsMobile()
  const pathname = usePathname()

  const content = (
    // QR tarayıcıda kamera akışıyla çakışmasın diye çekerek yenileme kapalı
    <PullToRefresh disabled={!isMobile || isNavActive(pathname, SCAN_HREF)}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </PullToRefresh>
  )

  // Koşullu öğeler yerlerini korur ({koşul && …}): içerik her boyutta aynı konumda kalır
  return (
    <SidebarProvider>
      {!isMobile && <AppSidebar />}
      {isMobile && <MobileTopBar />}
      <SidebarInset className="min-w-0">
        {!isMobile && <SiteHeader />}
        <div
          className="@container/main flex min-w-0 flex-1 flex-col"
          style={isMobile ? {
            paddingTop: `calc(${MOBILE_TOP_BAR_HEIGHT}px + env(safe-area-inset-top))`,
            paddingBottom: `calc(${BOTTOM_NAV_SPACE}px + env(safe-area-inset-bottom))`,
          } : undefined}
        >
          {content}
        </div>
      </SidebarInset>
      {isMobile && <MobileBottomNav />}
    </SidebarProvider>
  )
}
