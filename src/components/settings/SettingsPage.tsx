'use client'

/**
 * SettingsPage — mağaza konumu, resmi tatil takvimi, denetim kaydı ve anlık bildirim
 * teşhisi (Mağaza Müdürü+).
 */
import { useState } from 'react'
import { PageHeader } from '@/components/common'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StoreLocationPage } from './StoreLocationPage'
import { HolidaysPanel } from './HolidaysPanel'
import { AuditLogPanel } from './AuditLogPanel'
import { PushPermissionCard } from '@/components/pwa/PushPermissionCard'
import { PushDiagnosticsPanel } from '@/components/pwa/PushDiagnosticsPanel'

type SettingsTab = 'location' | 'holidays' | 'audit' | 'notifications'

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('location')
  return (
    <div className="p-4 text-ink md:p-6">
      <PageHeader title="Ayarlar" subtitle="Mağaza konumu, resmi tatiller, denetim kaydı ve bildirimler" />
      <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} className="gap-5">
        <TabsList>
          <TabsTrigger value="location">Mağaza konumu</TabsTrigger>
          <TabsTrigger value="holidays">Resmi tatiller</TabsTrigger>
          <TabsTrigger value="audit">Denetim kaydı</TabsTrigger>
          <TabsTrigger value="notifications">Bildirimler</TabsTrigger>
        </TabsList>
        {/* Yalnızca açık sekme bağlanır: paneller kendi verisini bağlandığında yükler */}
        <TabsContent value="location"><StoreLocationPage embedded /></TabsContent>
        <TabsContent value="holidays"><HolidaysPanel /></TabsContent>
        <TabsContent value="audit"><AuditLogPanel /></TabsContent>
        <TabsContent value="notifications">
          {/* PushPermissionCard kendi alt boşluğunu taşır */}
          <div className="max-w-[640px]">
            <PushPermissionCard />
            <PushDiagnosticsPanel />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
