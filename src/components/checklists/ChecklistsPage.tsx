'use client'

/**
 * ChecklistsPage — Kontrol listeleri: Bugün (herkes), Şablonlar ve Geçmiş (Müdür Yardımcısı+).
 */
import { useState } from 'react'

import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { Page, PageHeader, SegmentedControl } from '@/components/common'
import { HistoryPanel } from './HistoryPanel'
import { TemplatesPanel } from './TemplatesPanel'
import { TodayChecklists } from './TodayChecklists'

type Tab = 'today' | 'templates' | 'history'

export function ChecklistsPage() {
  const { employee } = useAuth()
  const isManager = hasRole(employee?.roles?.access_level, MANAGER_ROLES)
  const [tab, setTab] = useState<Tab>('today')

  return (
    <Page>
      <PageHeader
        title="Kontrol listeleri"
        description="Açılış, kapanış ve özel kontrol listeleri"
        actions={isManager && (
          <SegmentedControl<Tab>
            aria-label="Görünüm"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'today', label: 'Bugün' },
              { value: 'templates', label: 'Şablonlar' },
              { value: 'history', label: 'Geçmiş' },
            ]}
          />
        )}
      />
      {tab === 'today' || !isManager ? <TodayChecklists /> : tab === 'templates' ? <TemplatesPanel /> : <HistoryPanel />}
    </Page>
  )
}
