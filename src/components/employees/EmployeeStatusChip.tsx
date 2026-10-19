'use client'

import { Chip } from '@mui/material'
import { C, tint } from '@/lib/palette'

interface Props {
  active: boolean
}

export function EmployeeStatusChip({ active }: Props) {
  return (
    <Chip
      label={active ? 'Aktif' : 'Pasif'}
      size="small"
      variant="outlined"
      sx={{
        fontSize: '0.7rem',
        height: 22,
        fontWeight: 600,
        bgcolor: active ? tint(C.success, 0.1) : tint(C.neutral, 0.1),
        color: active ? C.success : C.inkMuted,
        borderColor: active ? tint(C.success, 0.3) : tint(C.neutral, 0.3),
      }}
    />
  )
}
