import type { Metadata } from 'next'
import { AttendanceScanPage } from '@/components/qr/AttendanceScanPage'

export const metadata: Metadata = { title: 'QR Tara' }

export default function Page() {
  return <AttendanceScanPage />
}
