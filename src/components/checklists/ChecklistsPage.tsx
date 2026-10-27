'use client'

/**
 * ChecklistsPage — Kontrol listeleri: Bugün (herkes), Şablonlar ve Geçmiş (Müdür Yardımcısı+).
 * Alt görünümler shadcn Tabs ile (DESIGN_GUIDE §4).
 */
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { Page, PageHeader } from '@/components/common'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HistoryPanel } from './HistoryPanel'
import { TemplatesPanel } from './TemplatesPanel'
import { TodayChecklists } from './TodayChecklists'

export function ChecklistsPage() {
  const { employee } = useAuth()
  const isManager = hasRole(employee?.roles?.access_level, MANAGER_ROLES)

  return (
    <Page>
      <PageHeader title="Kontrol listeleri" description="Açılış, kapanış ve özel kontrol listeleri" />
      {isManager ? (
        <Tabs defaultValue="today" className="gap-4">
          <TabsList className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="today">Bugün</TabsTrigger>
            <TabsTrigger value="templates">Şablonlar</TabsTrigger>
            <TabsTrigger value="history">Geçmiş</TabsTrigger>
          </TabsList>
          <TabsContent value="today"><TodayChecklists /></TabsContent>
          <TabsContent value="templates"><TemplatesPanel /></TabsContent>
          <TabsContent value="history"><HistoryPanel /></TabsContent>
        </Tabs>
      ) : (
        <TodayChecklists />
      )}
    </Page>
  )
}
