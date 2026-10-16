'use client'

/**
 * MobileBottomNav — mobilde (md altı) sabit alt sekme çubuğu.
 * Sekmeler role göre navItems.getBottomTabs'tan gelir; ortadaki QR Tara yükseltilmiş yuvarlak butondur.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Box, Typography } from '@mui/material'

import { useAuth } from '@/context/AuthContext'
import { getActiveTabHref, getBottomTabs, type BottomTab } from './navItems'

/** Alt bar yüksekliği (safe-area hariç) */
export const BOTTOM_NAV_HEIGHT = 64
const CENTER_SIZE = 56
/** Ortadaki QR butonunun barın üstüne taşan kısmı */
const CENTER_OVERHANG = CENTER_SIZE / 3
/**
 * Mobilde alttan konumlanan katmanların (çevrimdışı bandı, güncelleme uyarısı, kurulum kartı)
 * alt boşluğu (safe-area hariç): bar + taşan QR butonu + 8px. Yalnızca bar yüksekliği kadar
 * yukarıda duran katmanlar ortadaki QR butonunun üst kısmını örtüyordu.
 */
export const BOTTOM_NAV_OVERLAY_OFFSET = Math.ceil(BOTTOM_NAV_HEIGHT + CENTER_OVERHANG + 8)

export function MobileBottomNav() {
  const pathname = usePathname()
  const { employee, status } = useAuth()
  const roleName = employee?.roles?.name ?? employee?.role_name ?? null
  // Oturum yüklenirken çalışan sekmeleri gösterilip sonra yöneticiye dönmesin (flash)
  const tabs = status === 'loading' ? [] : getBottomTabs(roleName)
  const activeHref = getActiveTabHref(pathname, tabs)

  return (
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
        pb: 'env(safe-area-inset-bottom)',
        pl: 'env(safe-area-inset-left)',
        pr: 'env(safe-area-inset-right)',
        display: 'flex',
        alignItems: 'stretch',
        bgcolor: 'rgba(15,23,42,0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid',
        borderColor: 'divider',
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
  const common = {
    href: tab.href,
    prefetch: false,
    'aria-current': active ? ('page' as const) : undefined,
  }

  if (tab.center) {
    return (
      <Box
        component={Link}
        {...common}
        aria-label={tab.label}
        sx={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          textDecoration: 'none',
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          outline: 'none',
          '&:focus-visible > span': { outline: '2px solid', outlineColor: 'primary.light', outlineOffset: 3 },
        }}
      >
        <Box
          component="span"
          sx={{
            width: CENTER_SIZE,
            height: CENTER_SIZE,
            // Barın üstüne taşan yükseltilmiş buton
            mt: `-${CENTER_OVERHANG}px`,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: active ? 'primary.dark' : 'primary.main',
            color: '#0f172a',
            boxShadow: '0 6px 16px rgba(20,184,166,0.35), 0 0 0 4px #0f172a',
            transition: 'transform 0.15s, background-color 0.15s',
            '&:active': { transform: 'scale(0.94)' },
            '& svg': { fontSize: 28 },
          }}
        >
          {tab.icon}
        </Box>
      </Box>
    )
  }

  return (
    <Box
      component={Link}
      {...common}
      sx={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.25,
        textDecoration: 'none',
        color: active ? 'primary.main' : 'text.secondary',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        outline: 'none',
        '&:focus-visible': { bgcolor: 'rgba(20,184,166,0.12)' },
        '&:active': { opacity: 0.7 },
        '& svg': { fontSize: 24 },
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
