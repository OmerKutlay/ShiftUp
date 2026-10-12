import type { Metadata } from 'next'
import { EmployeesPage } from '@/components/employees'

export const metadata: Metadata = { title: 'Çalışanlar' }

export default function Page() {
  return <EmployeesPage />
}
