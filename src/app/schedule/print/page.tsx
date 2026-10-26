import type { Metadata } from 'next'
import { SchedulePrintPage } from '@/components/schedule/print/SchedulePrintPage'

export const metadata: Metadata = { title: 'Haftalık Plan Çıktısı' }

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string; auto?: string }> }) {
  const { week, auto } = await searchParams
  return <SchedulePrintPage week={week} auto={auto === '1'} />
}
