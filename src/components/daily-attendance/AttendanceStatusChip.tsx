'use client'

import { StatusBadge } from '@/components/common'
import { DAY_STATUS, type DayStatus } from './attendanceTime'

/** Günlük durum rozeti (Çalışıyor, Molada, Gelmedi, Gecikiyor, Başlamadı, Çıkış yaptı, İzinli) */
export function AttendanceStatusChip({ status, className }: { status: DayStatus; className?: string }) {
  const cfg = DAY_STATUS[status]
  return <StatusBadge tone={cfg.tone} label={cfg.label} className={className} />
}
