'use client'

/**
 * MobileBottomNav — telefonda alt sekme çubuğu.
 *
 * Beş eşit sütun (grid); her sekmede ikon + tek satır etiket, hepsi aynı taban çizgisinde.
 * Çubuk ekranın altına yapışık ve opaktır; ev göstergesi alanı (safe-area) çubuğun zemininde
 * kalır. Sekmeler role göre navItems.getBottomTabs'tan gelir.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useAuth } from '@/context/AuthContext'
import { getActiveTabHref, getBottomTabs, type BottomTab } from './navItems'
import { cn } from '@/lib/utils'

/** Alt bar yüksekliği (safe-area hariç) */
export const BOTTOM_NAV_HEIGHT = 56
/** İçeriğin altta bırakması gereken boşluk (safe-area hariç) */
export const BOTTOM_NAV_SPACE = BOTTOM_NAV_HEIGHT
/**
 * Mobilde alttan konumlanan katmanların (çevrimdışı bandı, güncelleme uyarısı, kurulum kartı)
 * alt boşluğu (safe-area hariç): alt barın 8px üstü.
 */
export const BOTTOM_NAV_OVERLAY_OFFSET = BOTTOM_NAV_SPACE + 8

export function MobileBottomNav() {
  const pathname = usePathname()
  const { employee, status } = useAuth()
  // Oturum yüklenirken çalışan sekmeleri gösterilip sonra yöneticiye dönmesin (flash)
  const tabs = status === 'loading' ? [] : getBottomTabs(employee?.roles?.access_level ?? null)
  const activeHref = getActiveTabHref(pathname, tabs)

  return (
    <nav
      aria-label="Alt menü"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] select-none [-webkit-touch-callout:none]"
    >
      <div className="grid grid-cols-5" style={{ height: BOTTOM_NAV_HEIGHT }}>
        {tabs.map((tab) => (
          <TabLink key={tab.href} tab={tab} active={tab.href === activeHref} />
        ))}
      </div>
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
        'relative flex min-w-0 flex-col items-center justify-center gap-1 outline-none transition-colors',
        'focus-visible:bg-accent active:bg-accent [&_svg]:size-5 [&_svg]:shrink-0',
        active ? 'text-primary' : 'text-muted-foreground'
      )}
    >
      {/* Aktif gösterge: ikonun üstünde ince çizgi */}
      <span
        aria-hidden
        className={cn('absolute top-0 h-0.5 w-8 rounded-full bg-primary transition-opacity', active ? 'opacity-100' : 'opacity-0')}
      />
      {tab.icon}
      <span className={cn('w-full truncate px-1 text-center text-[11px] leading-none', active ? 'font-semibold' : 'font-medium')}>
        {tab.label}
      </span>
    </Link>
  )
}
