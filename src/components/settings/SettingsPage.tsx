'use client'

/**
 * SettingsPage — Ayarlar (Mağaza Müdürü+): mağaza konumu, resmi tatil takvimi, denetim kaydı ve
 * anlık bildirimler. shadcn "settings" kalıbı: sekmeler → her sekmede başlıklı kartlar.
 */
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Bell, Bug, CalendarDays, Gauge, History, KeyRound, MapPin, ShieldCheck, Store } from 'lucide-react'
import { Page, PageHeader, PageTabsList, TabLabel } from '@/components/common'
import { Tabs, TabsContent, TabsTrigger } from '@/components/ui/tabs'
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
import { AdminLoginPanel } from './AdminLoginPanel'

type SettingsTab = 'location' | 'stores' | 'norms' | 'holidays' | 'audit' | 'errors' | 'admin' | 'notifications' | 'kvkk'

/** Sekme etiketi: masaüstünde ikon + tam ad, dar ekranda kısa ad */
const TABS: { value: SettingsTab; icon: React.ReactNode; label: string; short: string; adminOnly?: boolean }[] = [
  { value: 'location', icon: <MapPin />, label: 'Mağaza konumu', short: 'Konum' },
  { value: 'stores', icon: <Store />, label: 'Mağazalar', short: 'Mağazalar', adminOnly: true },
  { value: 'norms', icon: <Gauge />, label: 'Norm saatleri', short: 'Norm', adminOnly: true },
  { value: 'holidays', icon: <CalendarDays />, label: 'Resmi tatiller', short: 'Tatiller' },
  { value: 'audit', icon: <History />, label: 'Denetim kaydı', short: 'Denetim' },
  { value: 'errors', icon: <Bug />, label: 'Hatalar', short: 'Hatalar', adminOnly: true },
  { value: 'admin', icon: <KeyRound />, label: 'Admin girişi', short: 'Admin', adminOnly: true },
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
          ? 'Mağazalar, mağaza konumu, resmi tatiller, denetim kaydı, admin girişi, bildirimler ve KVKK'
          : 'Mağaza konumu, resmi tatiller, denetim kaydı, bildirimler ve KVKK'}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTab)} className="gap-4 md:gap-6">
        {/* Admin'in dokuz sekmesi mobilde 3 × 3 ızgara; diğer roller tek satıra sığar */}
        <PageTabsList columns={tabs.length > 5 ? 3 : undefined}>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="sm:px-3">
              <span className="hidden sm:contents">{t.icon}</span>
              <TabLabel short={t.short} long={t.label} />
            </TabsTrigger>
          ))}
        </PageTabsList>
        {/* Yalnızca açık sekme bağlanır: paneller kendi verisini bağlandığında yükler */}
        <TabsContent value="location"><StoreLocationPage embedded /></TabsContent>
        {isAdmin && <TabsContent value="stores"><StoresPanel /></TabsContent>}
        {isAdmin && <TabsContent value="norms"><NormHoursPanel /></TabsContent>}
        <TabsContent value="holidays"><HolidaysPanel /></TabsContent>
        <TabsContent value="audit"><AuditLogPanel /></TabsContent>
        {isAdmin && <TabsContent value="errors"><AppErrorsPanel /></TabsContent>}
        {isAdmin && <TabsContent value="admin"><AdminLoginPanel /></TabsContent>}
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
