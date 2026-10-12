import type { Metadata } from 'next'
import { DailyAttendancePage } from '@/components/daily-attendance'

export const metadata: Metadata = { title: 'Günlük Operasyon' }

export default function Page() {
  return <DailyAttendancePage />
}
