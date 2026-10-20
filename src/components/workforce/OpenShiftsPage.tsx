'use client'

import { OpenShiftsPanel } from './OpenShiftsPanel'
import { PageHeader } from '@/components/common'

export function OpenShiftsPage() {
  return (
    <div className="mx-auto w-full max-w-[800px] p-4 md:p-6">
      <PageHeader
        title="Açık vardiyalar"
        subtitle="Boşta kalan vardiyaları görüntüleyin ve üstlenin"
      />
      <OpenShiftsPanel />
    </div>
  )
}
