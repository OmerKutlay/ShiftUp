'use client'

import { StatusBadge } from '@/components/common'
import { isTerminatedAsOf } from '@/lib/employment'
import { TERMINATION_REASON_LABELS, type Employee } from '@/types/employee'
import { fmtDate } from './format'

interface Props {
  active: boolean
  /** Verilirse ayrılış bilgisi de gösterilir: "Ayrıldı · 31 Eki 2026 · İstifa" */
  employee?: Pick<Employee, 'termination_date' | 'termination_reason'>
}

export function EmployeeStatusChip({ active, employee }: Props) {
  const date = employee?.termination_date
  if (date) {
    const reason = employee?.termination_reason ? TERMINATION_REASON_LABELS[employee.termination_reason] : null
    const parts = [isTerminatedAsOf(employee) ? 'Ayrıldı' : 'Ayrılıyor', fmtDate(date), reason].filter(Boolean)
    return <StatusBadge tone={isTerminatedAsOf(employee) ? 'neutral' : 'warning'} label={parts.join(' · ')} />
  }
  return <StatusBadge tone={active ? 'success' : 'neutral'} label={active ? 'Aktif' : 'Pasif'} />
}
