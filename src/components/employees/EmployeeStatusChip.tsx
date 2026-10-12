'use client'

import { Chip } from '@mui/material'

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
        bgcolor: active ? 'rgba(16,185,129,0.1)' : 'rgba(100,116,139,0.1)',
        color: active ? '#10b981' : '#94a3b8',
        borderColor: active ? 'rgba(16,185,129,0.3)' : 'rgba(100,116,139,0.3)',
      }}
    />
  )
}
