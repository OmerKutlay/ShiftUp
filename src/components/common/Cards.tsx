'use client'

/**
 * Cards — yeni UI'ın ortak kart parçaları:
 *   StatCard     KPI kartı (etiket, büyük değer, alt not)
 *   StatGrid     KPI kartlarını eşit sütunlara dizer
 *   SectionCard  başlıklı (sayaç + bağlantı) liste kartı; satırlar ince çizgiyle ayrılır
 *   StatusBadge  yumuşak zeminli durum rozeti
 */
import Link from 'next/link'
import { Box, ButtonBase, Paper, Typography, type SxProps, type Theme } from '@mui/material'
import { C } from '@/lib/palette'

// ─── Rozet ────────────────────────────────────────────────────

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'plum' | 'peach' | 'brand' | 'neutral'

export const BADGE_TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: C.successSoft, fg: C.success },
  warning: { bg: C.warningSoft, fg: C.warning },
  danger: { bg: C.dangerSoft, fg: C.danger },
  info: { bg: C.infoSoft, fg: C.info },
  plum: { bg: C.plumSoft, fg: C.plum },
  peach: { bg: C.peachSoft, fg: C.peach },
  brand: { bg: C.brandSoft, fg: C.brandDark },
  neutral: { bg: C.surfaceMuted, fg: C.inkSecondary },
}

export function StatusBadge({ tone, label, icon, sx }: {
  tone: BadgeTone; label: React.ReactNode; icon?: React.ReactNode; sx?: SxProps<Theme>
}) {
  const t = BADGE_TONES[tone]
  return (
    <Box
      component="span"
      sx={[
        {
          display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0,
          px: 0.875, height: 22, borderRadius: '6px', bgcolor: t.bg, color: t.fg,
          fontSize: '0.7rem', fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap',
          '& svg': { fontSize: 13 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {icon}
      {label}
    </Box>
  )
}

// ─── KPI ──────────────────────────────────────────────────────

export function StatCard({ label, value, note, valueColor, icon, onClick, href }: {
  label: React.ReactNode
  value: React.ReactNode
  note?: React.ReactNode
  valueColor?: string
  icon?: React.ReactNode
  onClick?: () => void
  href?: string
}) {
  const interactive = !!(onClick || href)
  const content = (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary', '& svg': { fontSize: 16 } }}>
        {icon}
        <Typography fontSize="0.78rem" color="text.secondary" noWrap>{label}</Typography>
      </Box>
      <Typography
        fontWeight={700}
        sx={{ fontSize: { xs: '1.35rem', md: '1.6rem' }, lineHeight: 1.3, my: 0.25, color: valueColor ?? 'text.primary' }}
        noWrap
      >
        {value}
      </Typography>
      {note && <Typography fontSize="0.72rem" color="text.secondary" noWrap>{note}</Typography>}
    </>
  )
  const sx = {
    p: { xs: 1.5, md: 2 }, borderRadius: '14px', minWidth: 0, display: 'block', textAlign: 'left',
    fontFamily: 'inherit', width: '100%',
    ...(interactive && { '&:hover': { borderColor: C.sand }, transition: 'border-color 0.15s' }),
  } as const
  if (href) {
    return <Paper variant="outlined" component={Link} href={href} sx={{ ...sx, textDecoration: 'none', color: 'inherit' }}>{content}</Paper>
  }
  if (onClick) {
    return <Paper variant="outlined" component={ButtonBase} onClick={onClick} sx={sx}>{content}</Paper>
  }
  return <Paper variant="outlined" sx={sx}>{content}</Paper>
}

export function StatGrid({ children, min = 150, sx }: { children: React.ReactNode; min?: number; sx?: SxProps<Theme> }) {
  return (
    <Box
      sx={[
        {
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: `repeat(auto-fit, minmax(${min}px, 1fr))` },
          gap: { xs: 1.25, md: 2 },
          mb: { xs: 2, md: 3 },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  )
}

// ─── Bölüm kartı ──────────────────────────────────────────────

export function SectionCard({ title, count, subtitle, action, children, sx }: {
  title: React.ReactNode
  count?: number
  subtitle?: React.ReactNode
  /** Sağ üstteki bağlantı: { label: 'Tümü →', href } ya da özel düğüm */
  action?: { label: string; href: string } | React.ReactNode
  children: React.ReactNode
  sx?: SxProps<Theme>
}) {
  const actionNode = action && typeof action === 'object' && 'href' in action ? (
    <Typography
      component={Link}
      href={action.href}
      fontSize="0.8rem"
      fontWeight={600}
      sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
    >
      {action.label}
    </Typography>
  ) : action
  return (
    <Paper variant="outlined" sx={[{ borderRadius: '16px', overflow: 'hidden' }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 1.75, pb: 1.25 }}>
        <Typography fontWeight={700} fontSize="0.95rem">{title}</Typography>
        {count !== undefined && <Typography fontSize="0.78rem" color="text.secondary">{count}</Typography>}
        {subtitle && <Typography fontSize="0.75rem" color="text.secondary" noWrap sx={{ minWidth: 0 }}>{subtitle}</Typography>}
        <Box sx={{ flex: 1 }} />
        {actionNode}
      </Box>
      <Box sx={{ '& > *': { borderTop: '1px solid', borderColor: 'divider' } }}>
        {children}
      </Box>
    </Paper>
  )
}

/** SectionCard içindeki standart satır: sol (avatar + metin), sağ (rozet / değer) */
export function SectionRow({ children, onClick, href, sx }: {
  children: React.ReactNode; onClick?: () => void; href?: string; sx?: SxProps<Theme>
}) {
  const base = [
    {
      display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.25, minHeight: 56, width: '100%',
      textAlign: 'left', fontFamily: 'inherit', color: 'inherit', textDecoration: 'none',
    },
    (onClick || href) ? { '&:hover': { bgcolor: 'action.hover' } } : {},
    ...(Array.isArray(sx) ? sx : [sx]),
  ] as SxProps<Theme>
  if (href) return <Box component={Link} href={href} sx={base}>{children}</Box>
  if (onClick) return <ButtonBase onClick={onClick} sx={base}>{children}</ButtonBase>
  return <Box sx={base}>{children}</Box>
}

/** Kart içinde boş durum metni */
export function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <Typography fontSize="0.85rem" color="text.secondary" sx={{ px: 2, py: 3, textAlign: 'center' }}>
      {children}
    </Typography>
  )
}
