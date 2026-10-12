import type { Metadata } from 'next'
import { QrKioskPage } from '@/components/qr/QrKioskPage'

export const metadata: Metadata = { title: 'QR Kiosk' }

export default function Page() {
  return <QrKioskPage />
}
