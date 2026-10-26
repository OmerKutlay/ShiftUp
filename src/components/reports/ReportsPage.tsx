'use client'

/**
 * ReportsPage — Raporlar: devam raporu, aylık puantaj (Excel) ve yıllık fazla çalışma.
 */
import { Page, PageHeader } from '@/components/common'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AttendanceReportsPage } from './AttendanceReportsPage'
import { TimesheetPanel } from './TimesheetPanel'
import { OvertimePanel } from './OvertimePanel'
import { PayrollPanel } from './PayrollPanel'

export function ReportsPage() {
  return (
    <Page>
      <PageHeader title="Raporlar" description="Ekibin devamı, aylık puantaj ve fazla çalışma takibi" />
      {/* İçerik sekme değişince söküldüğü için (Radix varsayılanı) her panel kendi verisini yalnızca açıkken çeker */}
      <Tabs defaultValue="attendance" className="gap-4 md:gap-6">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="attendance">Devam raporu</TabsTrigger>
          <TabsTrigger value="timesheet">Aylık puantaj</TabsTrigger>
          <TabsTrigger value="overtime">Fazla çalışma</TabsTrigger>
          <TabsTrigger value="payroll">Bordro puantajı</TabsTrigger>
        </TabsList>
        <TabsContent value="attendance"><AttendanceReportsPage embedded /></TabsContent>
        <TabsContent value="timesheet"><TimesheetPanel /></TabsContent>
        <TabsContent value="overtime"><OvertimePanel /></TabsContent>
        <TabsContent value="payroll"><PayrollPanel /></TabsContent>
      </Tabs>
    </Page>
  )
}
