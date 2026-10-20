'use client'

import { OpenShiftsPanel } from './OpenShiftsPanel'
import { Page, PageHeader } from '@/components/common'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'

export function OpenShiftsPage() {
  const { employee } = useAuth()
  const isManager = hasRole(employee?.roles?.access_level ?? null, MANAGER_ROLES)
  return (
    <Page>
      <PageHeader
        title="Açık vardiyalar"
        description={isManager
          ? 'Boşta kalan vardiyaları havuza ekleyin; uygun çalışanlar üstlensin'
          : 'Boşta kalan vardiyaları görün ve kendi adınıza üstlenin'}
      />
      <OpenShiftsPanel />
    </Page>
  )
}
