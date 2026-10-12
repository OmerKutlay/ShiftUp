import type { Metadata } from 'next'
import { SchedulePageClient } from '@/components/schedule/SchedulePageClient'

export const metadata: Metadata = { title: 'Haftalık Plan' }

export default function Page() {
  return <SchedulePageClient />
}
