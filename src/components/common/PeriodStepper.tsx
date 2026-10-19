'use client'

/**
 * PeriodStepper — "‹ Ekim 2026 ›" biçiminde dönem gezgini (ay / hafta).
 */
import { Box, ButtonBase, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'

interface Props {
  label: React.ReactNode
  onPrev: () => void
  onNext: () => void
  prevLabel: string
  nextLabel: string
  /** Etiketin en az genişliği — dönem değişince kutu zıplamasın */
  minLabelWidth?: number
  /** İleri gitme kapalı (ör. gelecek ay) */
  nextDisabled?: boolean
}

const arrowSx = {
  width: 40,
  alignSelf: 'stretch',
  color: 'text.secondary',
  '&:hover': { bgcolor: 'action.hover' },
  '&.Mui-focusVisible': { bgcolor: 'action.selected' },
} as const

export function PeriodStepper({ label, onPrev, onNext, prevLabel, nextLabel, minLabelWidth = 96, nextDisabled }: Props) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 40,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '10px',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <ButtonBase onClick={onPrev} aria-label={prevLabel} sx={arrowSx}>
        <ChevronLeftIcon fontSize="small" />
      </ButtonBase>
      <Typography
        component="div"
        aria-live="polite"
        sx={{
          px: 1.5,
          minWidth: minLabelWidth,
          textAlign: 'center',
          fontWeight: 600,
          fontSize: '0.875rem',
          alignSelf: 'stretch',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderLeft: '1px solid',
          borderRight: '1px solid',
          borderColor: 'divider',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Typography>
      <ButtonBase onClick={onNext} aria-label={nextLabel} disabled={nextDisabled} sx={{ ...arrowSx, '&.Mui-disabled': { color: 'text.disabled' } }}>
        <ChevronRightIcon fontSize="small" />
      </ButtonBase>
    </Box>
  )
}
