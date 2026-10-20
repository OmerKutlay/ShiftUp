'use client'

/**
 * SettingsPage — Ayarlar (Mağaza Müdürü+): mağaza konumu, resmi tatil takvimi, denetim kaydı ve
 * anlık bildirimler. shadcn "settings" kalıbı: sekmeler → her sekmede başlıklı kartlar.
 */
import { useState } from 'react'
import { Bell, CalendarDays, History, MapPin } from 'lucide-react'
import { Page, PageHeader } from '@/components/common'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PushPermissionCard } from '@/components/pwa/PushPermissionCard'
import { PushDiagnosticsPanel } from '@/components/pwa/PushDiagnosticsPanel'
import { StoreLocationPage } from './StoreLocationPage'
import { HolidaysPanel } from './HolidaysPanel'
import { AuditLogPanel } from './AuditLogPanel'

type SettingsTab = 'location' | 'holidays' | 'audit' | 'notifications'

/** Sekme etiketi: masaüstünde ikon + tam ad, dar ekranda kısa ad (dört sekme 390px'e sığsın) */
const TABS: { value: SettingsTab; icon: React.ReactNode; label: string; short: string }[] = [
  { value: 'location', icon: <MapPin />, label: 'Mağaza konumu', short: 'Konum' },
  { value: 'holidays', icon: <CalendarDays />, label: 'Resmi tatiller', short: 'Tatiller' },
  { value: 'audit', icon: <History />, label: 'Denetim kaydı', short: 'Denetim' },
  { value: 'notifications', icon: <Bell />, label: 'Bildirimler', short: 'Bildirimler' },
]

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('location')
  return (
    <Page>
      <PageHeader title="Ayarlar" description="Mağaza konumu, resmi tatiller, denetim kaydı ve bildirimler" />
      <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} className="gap-4 md:gap-6">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="sm:px-3">
              <span className="hidden sm:contents">{t.icon}</span>
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Yalnızca açık sekme bağlanır: paneller kendi verisini bağlandığında yükler */}
        <TabsContent value="location"><StoreLocationPage embedded /></TabsContent>
        <TabsContent value="holidays"><HolidaysPanel /></TabsContent>
        <TabsContent value="audit"><AuditLogPanel /></TabsContent>
        <TabsContent value="notifications">
          <div className="flex max-w-3xl flex-col gap-4 md:gap-6">
            <PushPermissionCard />
            <PushDiagnosticsPanel />
          </div>
        </TabsContent>
      </Tabs>
    </Page>
  )
}
