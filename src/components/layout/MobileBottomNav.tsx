'use client'

/**
 * MobileBottomNav — mobilde (md altı) alt sekme çubuğu.
 * Sekmeler role göre navItems.getBottomTabs'tan gelir; ekranın altına yapışık, aktif sekme açık kiremit zeminli.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Box, Typography } from '@mui/material'

import { useAuth } from '@/context/AuthContext'
import { getActiveTabHref, getBottomTabs, type BottomTab } from './navItems'
import { C, tint } from '@/lib/palette'

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
    <Box
      component="nav"
      aria-label="Alt menü"
      sx={(theme) => ({
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: theme.zIndex.appBar,
        height: `calc(${BOTTOM_NAV_HEIGHT}px + env(safe-area-inset-bottom))`,
        pt: 0.75,
        px: 'calc(8px + env(safe-area-inset-left))',
        pb: 'calc(6px + env(safe-area-inset-bottom))',
        display: 'flex',
        alignItems: 'stretch',
        gap: 0.5,
        bgcolor: 'background.paper',
        borderTop: '1px solid',
        borderColor: 'divider',
        boxShadow: `0 -4px 16px ${tint(C.ink, 0.05)}`,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      })}
    >
      {tabs.map((tab) => (
        <TabLink key={tab.href} tab={tab} active={tab.href === activeHref} />
      ))}
    </Box>
  )
}

function TabLink({ tab, active }: { tab: BottomTab; active: boolean }) {
  return (
    <Box
      component={Link}
      href={tab.href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.25,
        borderRadius: '14px',
        textDecoration: 'none',
        color: active ? 'primary.main' : 'text.secondary',
        bgcolor: active ? C.brandSoft : 'transparent',
        transition: 'background-color 0.15s',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        outline: 'none',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.light' },
        '&:active': { opacity: 0.7 },
        '& svg': { fontSize: 22 },
      }}
    >
      {tab.icon}
      <Typography
        component="span"
        sx={{ fontSize: '0.68rem', fontWeight: active ? 700 : 500, lineHeight: 1.2, maxWidth: '100%' }}
        noWrap
      >
        {tab.label}
      </Typography>
    </Box>
  )
}
