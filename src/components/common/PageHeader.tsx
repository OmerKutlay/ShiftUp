'use client'

/**
 * PageHeader — Tüm sayfalarda ortak başlık yapısı.
 *
 *   [ikon] OVERLINE
 *   Başlık                                   [aksiyonlar]
 *   alt başlık
 *   meta (ör. son güncelleme)
 */
import { Box, Typography } from '@mui/material'
import type { SvgIconComponent } from '@mui/icons-material'

interface PageHeaderProps {
  icon: SvgIconComponent
  overline: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Alt başlığın altındaki küçük, soluk satır */
  meta?: React.ReactNode
  /** Sağ üstte gösterilecek buton(lar) */
  actions?: React.ReactNode
  /** Başlığın yanında gösterilecek chip vb. */
  titleAdornment?: React.ReactNode
}

export function PageHeader({ icon: Icon, overline, title, subtitle, meta, actions, titleAdornment }: PageHeaderProps) {
  return (
    <Box
      component="header"
      sx={{ mb: 3, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Icon sx={{ fontSize: 18, color: 'primary.main' }} />
          <Typography variant="overline" color="primary.main" fontWeight={700} letterSpacing={1.5} lineHeight={1.6}>
            {overline}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="h5" component="h1" fontWeight={800} color="text.primary">
            {title}
          </Typography>
          {titleAdornment}
        </Box>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
        {meta && (
          <Typography variant="caption" color="text.disabled" sx={{ mt: 0.25, display: 'block' }}>
            {meta}
          </Typography>
        )}
      </Box>
      {actions && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', alignSelf: 'flex-start' }}>
          {actions}
        </Box>
      )}
    </Box>
  )
}
