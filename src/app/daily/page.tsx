import type { Metadata } from 'next'
import { DailyAttendancePage } from '@/components/daily-attendance'

export const metadata: Metadata = { title: 'Günlük Operasyon' }

/** Günlük operasyonun çalışan adresi ('/' yöneticinin ana sayfası; bkz. navItems DAILY_EMPLOYEE_HREF) */
export default function Page() {
  return <DailyAttendancePage />
}
