import type { Metadata } from 'next'
import { ShiftTemplatesPage } from '@/components/shift-templates'

export const metadata: Metadata = { title: 'Vardiya Şablonları' }

export default function Page() {
  return <ShiftTemplatesPage />
}
