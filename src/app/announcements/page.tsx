import type { Metadata } from 'next'
import { AnnouncementsPage } from '@/components/announcements/AnnouncementsPage'

export const metadata: Metadata = { title: 'Duyurular' }

export default function Page() {
  return <AnnouncementsPage />
}
