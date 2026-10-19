'use client'

import { StatusBadge } from '@/components/common'

interface Props {
  active: boolean
}

export function EmployeeStatusChip({ active }: Props) {
  return <StatusBadge tone={active ? 'success' : 'neutral'} label={active ? 'Aktif' : 'Pasif'} />
}
