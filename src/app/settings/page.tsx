import type { Metadata } from 'next'
import { StoreLocationPage } from '@/components/settings/StoreLocationPage'

export const metadata: Metadata = { title: 'Ayarlar' }

export default function Page() {
  return <StoreLocationPage />
}
