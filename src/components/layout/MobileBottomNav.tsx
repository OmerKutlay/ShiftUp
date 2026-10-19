'use client'

/**
 * MobileBottomNav — mobilde (md altı) alt sekme çubuğu.
 * Sekmeler role göre navItems.getBottomTabs'tan gelir; ekranın altına yapışık, aktif sekme açık kiremit zeminli.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useAuth } from '@/context/AuthContext'
import { getActiveTabHref, getBottomTabs, type BottomTab } from './navItems'
import { cn } from '@/lib/utils'

/** Alt bar yüksekliği (safe-area hariç) */
export const BOTTOM_NAV_HEIGHT = 64
/** İçeriğin altta bırakması gereken boşluk (safe-area body padding'inden gelir) */
export const BOTTOM_NAV_SPACE = BOTTOM_NAV_HEIGHT
/**
 * Mobilde alttan konumlanan katmanların (çevrimdışı bandı, güncelleme uyarısı, kurulum kartı)
 * alt boşluğu (safe-area hariç): alt barın 8px üstü.
 */
export const BOTTOM_NAV_OVERLAY_OFFSET = BOTTOM_NAV_SPACE + 8

export function MobileBottomNav() {
  const pathname = usePathname()
  const { employee, status } = useAuth()
  const roleName = employee?.roles?.name ?? employee?.role_name ?? null
  // Oturum yüklenirken çalışan sekmeleri gösterilip sonra yöneticiye dönmesin (flash)
  const tabs = status === 'loading' ? [] : getBottomTabs(roleName)
  const activeHref = getActiveTabHref(pathname, tabs)

  return (
    // Ekranın altına yapışık, opak bar; home-indicator alanı (safe-area) barın zemininde kalır
    <nav
      aria-label="Alt menü"
      className="fixed inset-x-0 bottom-0 z-[1100] flex items-stretch gap-1 border-t bg-card pt-1.5 pr-[calc(8px+env(safe-area-inset-right))] pb-[calc(6px+env(safe-area-inset-bottom))] pl-[calc(8px+env(safe-area-inset-left))] shadow-[0_-4px_16px_rgb(43_33_27/0.05)] select-none [-webkit-touch-callout:none]"
      style={{ height: `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom))` }}
    >
      {tabs.map((tab) => (
        <TabLink key={tab.href} tab={tab} active={tab.href === activeHref} />
      ))}
    </nav>
  )
}

function TabLink({ tab, active }: { tab: BottomTab; active: boolean }) {
  return (
    <Link
      href={tab.href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70 [&_svg]:size-[22px]',
        active ? 'bg-accent text-primary' : 'text-ink-secondary'
      )}
    >
      {tab.icon}
      <span className={cn('max-w-full truncate text-[0.68rem] leading-tight', active ? 'font-bold' : 'font-medium')}>
        {tab.label}
      </span>
    </Link>
  )
}
