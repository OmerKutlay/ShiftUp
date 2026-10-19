'use client'

/**
 * PageHeader — Tüm sayfalarda ortak başlık yapısı.
 *
 *   üst satır (ör. "Günaydın, Mehmet")
 *   Başlık                                   [aksiyonlar]
 *   alt başlık
 *   meta (ör. son güncelleme)
 */
import { Box, Typography } from '@mui/material'

interface PageHeaderProps {
  /** Başlığın üstündeki küçük, soluk satır */
  overline?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Alt başlığın altındaki küçük, soluk satır */
  meta?: React.ReactNode
  /** Sağ üstte gösterilecek buton(lar) */
  actions?: React.ReactNode
  /** Başlığın yanında gösterilecek chip vb. */
  titleAdornment?: React.ReactNode
}

export function PageHeader({ overline, title, subtitle, meta, actions, titleAdornment }: PageHeaderProps) {
  return (
    <Box
      component="header"
      sx={{ mb: 3, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}
    >
      <Box sx={{ minWidth: 0 }}>
        {overline && (
          <Typography variant="caption" component="p" color="text.secondary" fontWeight={500} sx={{ mb: 0.25 }}>
            {overline}
          </Typography>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography
            component="h1"
            color="text.primary"
            sx={{ fontWeight: 700, fontSize: { xs: '1.6rem', md: '1.85rem' }, lineHeight: 1.2, letterSpacing: '-0.01em' }}
          >
            {title}
          </Typography>
          {titleAdornment}
        </Box>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
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
