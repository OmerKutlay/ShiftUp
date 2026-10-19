'use client'

/**
 * MobileBottomNav — mobilde (md altı) alt sekme çubuğu.
 * Sekmeler role göre navItems.getBottomTabs'tan gelir; ekranın altında yüzen kart, aktif sekme açık kiremit zeminli.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Box, Typography } from '@mui/material'

import { useAuth } from '@/context/AuthContext'
import { getActiveTabHref, getBottomTabs, type BottomTab } from './navItems'
import { C, tint } from '@/lib/palette'

/** Alt bar kartının yüksekliği (safe-area hariç) */
export const BOTTOM_NAV_HEIGHT = 64
/** Kartın ekran kenarlarına uzaklığı (yüzen kart) */
const NAV_GAP = 10
/** İçeriğin altta bırakması gereken boşluk: kart + alt boşluk */
export const BOTTOM_NAV_SPACE = BOTTOM_NAV_HEIGHT + NAV_GAP
/**
 * Mobilde alttan konumlanan katmanların (çevrimdışı bandı, güncelleme uyarısı, kurulum kartı)
 * alt boşluğu (safe-area hariç): yüzen kartın üstünde 8px.
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
    // Dış kutu ekranın altına yapışık ve saydam; görünen kısım içteki yüzen kart
    <Box
      component="nav"
      aria-label="Alt menü"
      sx={(theme) => ({
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: theme.zIndex.appBar,
        pb: `calc(${NAV_GAP}px + env(safe-area-inset-bottom))`,
        pl: `calc(${NAV_GAP}px + env(safe-area-inset-left))`,
        pr: `calc(${NAV_GAP}px + env(safe-area-inset-right))`,
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      })}
    >
      <Box
        sx={{
          height: BOTTOM_NAV_HEIGHT,
          display: 'flex',
          alignItems: 'stretch',
          gap: 0.5,
          p: 0.75,
          pointerEvents: 'auto',
          bgcolor: tint(C.surface, 0.94),
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '20px',
          boxShadow: `0 6px 20px ${tint(C.ink, 0.08)}`,
        }}
      >
        {tabs.map((tab) => (
          <TabLink key={tab.href} tab={tab} active={tab.href === activeHref} />
        ))}
      </Box>
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
