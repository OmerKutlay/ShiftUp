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

const TABS = [
  { value: 'attendance', label: 'Devam raporu', short: 'Devam' },
  { value: 'timesheet', label: 'Aylık puantaj', short: 'Puantaj' },
  { value: 'overtime', label: 'Fazla çalışma', short: 'Fazla mesai' },
  { value: 'payroll', label: 'Bordro puantajı', short: 'Bordro' },
]

export function ReportsPage() {
  return (
    <Page>
      <PageHeader title="Raporlar" description="Ekibin devamı, aylık puantaj ve fazla çalışma takibi" />
      {/* İçerik sekme değişince söküldüğü için (Radix varsayılanı) her panel kendi verisini yalnızca açıkken çeker */}
      <Tabs defaultValue="attendance" className="gap-4 md:gap-6">
        {/* Mobilde kısa etiketlerle tam genişlik: kaydırma olmadan sığar */}
        <TabsList className="w-full sm:w-fit">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} aria-label={t.label}>
              <span className="sm:hidden" aria-hidden>{t.short}</span>
              <span className="max-sm:hidden">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="attendance"><AttendanceReportsPage embedded /></TabsContent>
        <TabsContent value="timesheet"><TimesheetPanel /></TabsContent>
        <TabsContent value="overtime"><OvertimePanel /></TabsContent>
        <TabsContent value="payroll"><PayrollPanel /></TabsContent>
      </Tabs>
    </Page>
  )
}
