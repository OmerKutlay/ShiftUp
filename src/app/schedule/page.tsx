'use client'

import { WeeklySchedulePage } from '@/components/schedule'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'

export default function Page() {
  const { employee } = useAuth()
  const isManager = hasRole(
    employee?.roles?.name ?? employee?.role_name ?? null,
    MANAGER_ROLES
  )
  return <WeeklySchedulePage readOnly={!isManager} />
}
