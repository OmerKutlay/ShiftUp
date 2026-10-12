import type { Metadata } from 'next'
import { AttendanceReportsPage } from '@/components/reports/AttendanceReportsPage'

export const metadata: Metadata = { title: 'Raporlar' }

export default function Page() {
  return <AttendanceReportsPage />
}
