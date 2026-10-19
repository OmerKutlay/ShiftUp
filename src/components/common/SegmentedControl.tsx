'use client'

/**
 * SegmentedControl — bej zemin üstünde beyaz seçili seçenekli hap grup (Kişiler / Tablo, Hafta / Gün).
 */
import { Box, ButtonBase } from '@mui/material'
import { tint, C } from '@/lib/palette'

interface Option<T extends string> {
  value: T
  label: React.ReactNode
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: Option<T>[]
  'aria-label': string
  /** Seçili seçenek koyu (mürekkep) zeminli — mobil sekme görünümü */
  dark?: boolean
  fullWidth?: boolean
}

export function SegmentedControl<T extends string>({ value, onChange, options, dark, fullWidth, ...rest }: Props<T>) {
  return (
    <Box
      role="group"
      aria-label={rest['aria-label']}
      sx={{
        display: fullWidth ? 'flex' : 'inline-flex',
        p: '3px',
        gap: '2px',
        height: 40,
        bgcolor: C.surfaceMuted,
        borderRadius: '10px',
        flexShrink: 0,
      }}
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <ButtonBase
            key={o.value}
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            sx={{
              flex: fullWidth ? 1 : 'none',
              px: 1.75,
              borderRadius: '8px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
              color: selected ? (dark ? C.white : 'text.primary') : 'text.secondary',
              bgcolor: selected ? (dark ? C.ink : 'background.paper') : 'transparent',
              boxShadow: selected && !dark ? `0 1px 2px ${tint(C.ink, 0.08)}` : 'none',
              transition: 'background-color 0.15s, color 0.15s',
              '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.light' },
            }}
          >
            {o.label}
          </ButtonBase>
        )
      })}
    </Box>
  )
}
