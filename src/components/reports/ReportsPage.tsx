'use client'

/**
 * ReportsPage — Raporlar: devam raporu, aylık puantaj (Excel) ve yıllık fazla çalışma.
 */
import { PageHeader } from '@/components/common'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AttendanceReportsPage } from './AttendanceReportsPage'
import { TimesheetPanel } from './TimesheetPanel'
import { OvertimePanel } from './OvertimePanel'

export function ReportsPage() {
  return (
    <div className="p-4 text-ink md:p-6">
      <PageHeader
        title="Raporlar"
        subtitle="Ekibin devamı, aylık puantaj ve fazla çalışma takibi"
      />
      {/* İçerik sekme değişince söküldüğü için (Radix varsayılanı) her panel kendi verisini yalnızca açıkken çeker */}
      <Tabs defaultValue="attendance" className="gap-5">
        <TabsList>
          <TabsTrigger value="attendance">Devam raporu</TabsTrigger>
          <TabsTrigger value="timesheet">Aylık puantaj</TabsTrigger>
          <TabsTrigger value="overtime">Fazla çalışma</TabsTrigger>
        </TabsList>
        <TabsContent value="attendance"><AttendanceReportsPage embedded /></TabsContent>
        <TabsContent value="timesheet"><TimesheetPanel /></TabsContent>
        <TabsContent value="overtime"><OvertimePanel /></TabsContent>
      </Tabs>
    </div>
  )
}
