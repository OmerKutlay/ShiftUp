'use client'
/**
 * WorkforcePage — İş gücü: Müsaitlik, Açık vardiyalar, Vardiya takası, Haftalık plan (manager+).
 * Çalışan aynı sayfayı "Müsaitlik ve takas" olarak görür: kendi müsaitliği, kendi takas talepleri ve
 * açık vardiyalar; Haftalık plan sekmesi görünmez. Yetkiler API'lerde uygulanır.
 *
 * Sekme sayaçları panellerle aynı SWR anahtarlarını kullanır (istek bir kez atılır):
 *   Müsaitlik   kaydı olan çalışan sayısı (çalışan için kendi kayıt sayısı)
 *   Açık        açık durumdaki vardiyalar
 *   Takas       kullanıcının işlem yapması gereken talepler
 *
 * ?tab=swap gibi bir parametreyle açılırsa o sekme seçilir (ör. takas bildirimine tıklanınca).
 */
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { format } from 'date-fns'
import { ArrowLeftRight, BriefcaseBusiness, CalendarClock, CalendarRange, TriangleAlert } from 'lucide-react'
import { AvailabilityEditor } from './AvailabilityEditor'
import { OpenShiftsPanel } from './OpenShiftsPanel'
import { ShiftSwapPanel, swapPermissions } from './ShiftSwapPanel'
import { WorkforcePlanningPanel } from './WorkforcePlanningPanel'
import {
  SWAPS_KEY, availabilityKey, fetchAvailability, fetchOpenShifts, fetchSwaps, openShiftsKey,
} from './workforceShared'
import { fetchActiveEmployees } from '@/lib/api/employees'
import { fetchWeeklyAssignments } from '@/lib/api/schedule'
import { useAuth } from '@/context/AuthContext'
import { hasRole, MANAGER_ROLES } from '@/lib/auth/roles'
import { Page, PageHeader, TableSkeleton } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type WorkforceTab = 'availability' | 'open-shifts' | 'swap' | 'plan'

/** Telefonda kısa, geniş ekranda uzun sekme adı; erişilebilir ad her zaman uzun ad */
function TabLabel({ short, long }: { short: string; long: string }) {
  return (
    <>
      <span className="sm:hidden" aria-hidden>{short}</span>
      <span className="max-sm:hidden">{long}</span>
    </>
  )
}

function Count({ n }: { n: number | undefined }) {
  if (!n) return null
  return <Badge variant="secondary" className="tabular-nums">{n}</Badge>
}

const URL_TABS: WorkforceTab[] = ['availability', 'open-shifts', 'swap', 'plan']

/** URL'deki ?tab= değerini sekmeye uygular; Suspense içinde olduğundan sayfanın geri kalanı önceden çizilir */
function TabFromUrl({ onTab, allowPlan }: { onTab: (t: WorkforceTab) => void; allowPlan: boolean }) {
  const param = useSearchParams().get('tab')
  useEffect(() => {
    const t = URL_TABS.find((x) => x === param)
    if (t && (t !== 'plan' || allowPlan)) onTab(t)
  }, [param, allowPlan, onTab])
  return null
}

export function WorkforcePage() {
  const [tab, setTab] = useState<WorkforceTab>('availability')

  const { employee: authEmployee } = useAuth()
  const meId = authEmployee?.id ?? null
  const isManager = hasRole(
    authEmployee?.roles?.access_level ?? null,
    MANAGER_ROLES
  )

  // SWR önbelleği: sayfaya dönüşte son veri hemen görünür, arka planda tazelenir
  const employeesQ = useSWR('employees:active', fetchActiveEmployees)
  const today = format(new Date(), 'yyyy-MM-dd')
  const assignmentsQ = useSWR(['shifts:week', today], () => fetchWeeklyAssignments(new Date(`${today}T12:00:00`)))
  const employees = employeesQ.data ?? []
  const assignments = assignmentsQ.data ?? []
  const isFirstLoad = (!employeesQ.data && !employeesQ.error) || (!assignmentsQ.data && !assignmentsQ.error)
  const loadError = employeesQ.error ?? assignmentsQ.error
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Yükleme hatası.') : null

  // ── Sekme sayaçları (paneller aynı önbelleği kullanır) ──
  const availQ = useSWR(meId ? availabilityKey(isManager, meId) : null, fetchAvailability)
  const openQ = useSWR(openShiftsKey('open'), fetchOpenShifts)
  const swapsQ = useSWR(SWAPS_KEY, fetchSwaps)
  const availabilityCount = availQ.data
    ? isManager
      ? new Set(availQ.data.availability.map((a) => a.employee_id)).size
      : availQ.data.availability.length
    : undefined
  const openCount = openQ.data?.open_shifts.length
  const swapActionCount = swapsQ.data?.swap_requests.filter((s) => {
    const p = swapPermissions(s, meId, isManager)
    return p.canRespond || p.canReview
  }).length

  return (
    <Page>
      <PageHeader
        title={isManager ? 'İş gücü' : 'Müsaitlik ve takas'}
        description={isManager
          ? 'Müsaitlik, açık vardiyalar, vardiya takasları ve haftalık plan'
          : 'Çalışamayacağınız saatleri bildirin, vardiya takası isteyin veya açık vardiyaları üstlenin'}
      />

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Çalışan ve vardiya bilgileri yüklenemedi</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Suspense fallback={null}>
        <TabFromUrl onTab={setTab} allowPlan={isManager} />
      </Suspense>

      <Tabs value={tab} onValueChange={(v) => setTab(v as WorkforceTab)} className="gap-4 md:gap-6">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="availability" className="flex-none">
            <CalendarClock />Müsaitlik<Count n={availabilityCount} />
          </TabsTrigger>
          <TabsTrigger value="open-shifts" className="flex-none" aria-label="Açık vardiyalar">
            <BriefcaseBusiness /><TabLabel short="Açık" long="Açık vardiyalar" /><Count n={openCount} />
          </TabsTrigger>
          <TabsTrigger value="swap" className="flex-none" aria-label="Vardiya takası">
            <ArrowLeftRight /><TabLabel short="Takas" long="Vardiya takası" /><Count n={swapActionCount} />
          </TabsTrigger>
          {/* Haftalık planlama yalnızca manager+ için görünür */}
          {isManager && (
            <TabsTrigger value="plan" className="flex-none" aria-label="Haftalık plan">
              <CalendarRange /><TabLabel short="Plan" long="Haftalık plan" />
            </TabsTrigger>
          )}
        </TabsList>

        {/* Çalışan/vardiya verisi gelene kadar yalnızca bunlara bağımlı sekmeler skeleton gösterir */}
        <TabsContent value="availability">
          {isFirstLoad ? (
            <TableSkeleton rows={8} columns={8} />
          ) : authEmployee && (
            <AvailabilityEditor employees={employees} currentEmployeeId={authEmployee.id} isManager={isManager} />
          )}
        </TabsContent>
        <TabsContent value="open-shifts">
          <OpenShiftsPanel />
        </TabsContent>
        <TabsContent value="swap">
          {isFirstLoad ? (
            <TableSkeleton rows={5} columns={4} />
          ) : (
            <ShiftSwapPanel
              employees={employees}
              assignments={assignments}
              currentEmployeeId={meId}
              isManager={isManager}
            />
          )}
        </TabsContent>
        {/* Planlama paneli yalnızca isManager=true iken render edilir */}
        {isManager && (
          <TabsContent value="plan">
            <WorkforcePlanningPanel />
          </TabsContent>
        )}
      </Tabs>
    </Page>
  )
}
