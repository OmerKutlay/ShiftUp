import type { Metadata } from 'next'
import { ChecklistsPage } from '@/components/checklists'

export const metadata: Metadata = { title: 'Kontrol Listeleri' }

export default function Page() {
  return <ChecklistsPage />
}
