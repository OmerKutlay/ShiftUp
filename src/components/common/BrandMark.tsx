'use client'

/**
 * BrandMark — kiremit kare logo (beyaz güneş). public/icon-*.png ile aynı çizim.
 */
import { Box } from '@mui/material'
import WbSunnyOutlinedIcon from '@mui/icons-material/WbSunnyOutlined'
import { C } from '@/lib/palette'

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: `${Math.round(size * 0.28)}px`,
        bgcolor: 'primary.main',
        color: C.white,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        '& svg': { fontSize: size * 0.62 },
      }}
    >
      <WbSunnyOutlinedIcon />
    </Box>
  )
}
