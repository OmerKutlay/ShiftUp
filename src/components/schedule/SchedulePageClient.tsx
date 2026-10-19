'use client'

import { WeeklySchedulePage } from './WeeklySchedulePage'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'

/** Yöneticiler planı düzenler; diğer çalışanlar salt okunur görür (yetki sunucuda da kontrol edilir). */
export function SchedulePageClient() {
  const { employee } = useAuth()
  const isManager = hasRole(employee?.roles?.access_level ?? null, MANAGER_ROLES)
  return <WeeklySchedulePage readOnly={!isManager} />
}
