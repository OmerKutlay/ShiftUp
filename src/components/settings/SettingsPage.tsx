'use client'

/**
 * SettingsPage — Ayarlar (Mağaza Müdürü+): mağaza konumu, resmi tatil takvimi, denetim kaydı ve
 * anlık bildirimler. shadcn "settings" kalıbı: sekmeler → her sekmede başlıklı kartlar.
 */
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Bell, Bug, CalendarDays, Gauge, History, MapPin, ShieldCheck, Store } from 'lucide-react'
import { Page, PageHeader } from '@/components/common'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PushPermissionCard } from '@/components/pwa/PushPermissionCard'
import { PushDiagnosticsPanel } from '@/components/pwa/PushDiagnosticsPanel'
import { StoresPanel } from '@/components/stores/StoresPanel'
import { useAuth } from '@/context/AuthContext'
import { ACCESS } from '@/lib/auth/roles'
import { StoreLocationPage } from './StoreLocationPage'
import { HolidaysPanel } from './HolidaysPanel'
import { AuditLogPanel } from './AuditLogPanel'
import { AppErrorsPanel } from './AppErrorsPanel'
import { KvkkPanel } from './KvkkPanel'
import { NormHoursPanel } from './NormHoursPanel'

type SettingsTab = 'location' | 'stores' | 'norms' | 'holidays' | 'audit' | 'errors' | 'notifications' | 'kvkk'

/** Sekme etiketi: masaüstünde ikon + tam ad, dar ekranda kısa ad (dört sekme 390px'e sığsın) */
const TABS: { value: SettingsTab; icon: React.ReactNode; label: string; short: string; adminOnly?: boolean }[] = [
  { value: 'location', icon: <MapPin />, label: 'Mağaza konumu', short: 'Konum' },
  { value: 'stores', icon: <Store />, label: 'Mağazalar', short: 'Mağazalar', adminOnly: true },
  { value: 'norms', icon: <Gauge />, label: 'Norm saatleri', short: 'Norm', adminOnly: true },
  { value: 'holidays', icon: <CalendarDays />, label: 'Resmi tatiller', short: 'Tatiller' },
  { value: 'audit', icon: <History />, label: 'Denetim kaydı', short: 'Denetim' },
  { value: 'errors', icon: <Bug />, label: 'Hatalar', short: 'Hatalar', adminOnly: true },
  { value: 'notifications', icon: <Bell />, label: 'Bildirimler', short: 'Bildirimler' },
  { value: 'kvkk', icon: <ShieldCheck />, label: 'KVKK', short: 'KVKK' },
]

/** URL'deki ?tab= değerini sekmeye uygular (ör. yan menüden "Mağazaları yönet" → ?tab=stores); Suspense içinde çalışır */
function TabFromUrl({ onTab, isAdmin }: { onTab: (t: SettingsTab) => void; isAdmin: boolean }) {
  const param = useSearchParams().get('tab')
  useEffect(() => {
    const t = TABS.find((x) => x.value === param)
    if (t && (!t.adminOnly || isAdmin)) onTab(t.value)
  }, [param, isAdmin, onTab])
  return null
}

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('location')
  const { employee } = useAuth()
  const isAdmin = employee?.roles?.access_level === ACCESS.ADMIN
  const tabs = TABS.filter((t) => !t.adminOnly || isAdmin)
  return (
    <Page>
      <Suspense fallback={null}>
        <TabFromUrl onTab={setTab} isAdmin={isAdmin} />
      </Suspense>
      <PageHeader
        title="Ayarlar"
        description={isAdmin
          ? 'Mağazalar, mağaza konumu, resmi tatiller, denetim kaydı, bildirimler ve KVKK'
          : 'Mağaza konumu, resmi tatiller, denetim kaydı, bildirimler ve KVKK'}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} className="gap-4 md:gap-6">
        <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden scrollbar-none sm:w-fit">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="sm:px-3">
              <span className="hidden sm:contents">{t.icon}</span>
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Yalnızca açık sekme bağlanır: paneller kendi verisini bağlandığında yükler */}
        <TabsContent value="location"><StoreLocationPage embedded /></TabsContent>
        {isAdmin && <TabsContent value="stores"><StoresPanel /></TabsContent>}
        {isAdmin && <TabsContent value="norms"><NormHoursPanel /></TabsContent>}
        <TabsContent value="holidays"><HolidaysPanel /></TabsContent>
        <TabsContent value="audit"><AuditLogPanel /></TabsContent>
        {isAdmin && <TabsContent value="errors"><AppErrorsPanel /></TabsContent>}
        <TabsContent value="kvkk"><KvkkPanel /></TabsContent>
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
