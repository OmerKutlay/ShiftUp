import type { Metadata } from 'next'
import { LeavePage } from '@/components/leave/LeavePage'

export const metadata: Metadata = { title: 'İzin Talepleri' }

export default function Page() {
  return <LeavePage />
}
