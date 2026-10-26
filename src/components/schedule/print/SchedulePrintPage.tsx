'use client'

/**
 * SchedulePrintPage — /schedule/print?week=YYYY-MM-DD: haftalık planın yazdırılabilir çıktısı.
 * Aynı veri katmanı (useWeeklySchedule) ve aynı rol/mağaza kapsamı kullanılır; ekranda küçük bir araç
 * çubuğu (Yazdır, hafta gezgini, Plana dön), yazdırırken yalnızca çıktı tablosu görünür.
 * ?auto=1 → veri yüklenince yazdırma penceresi kendiliğinden açılır.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { addWeeks, format, subWeeks } from 'date-fns'
import { ArrowLeft, Printer } from 'lucide-react'

import type { WeeklyScheduleEntry } from '@/types/schedule'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { PeriodStepper } from '@/components/common'
import { useWeeklySchedule } from '../useWeeklySchedule'
import { calcEmployeeStats, compareRoles, type EmployeeWeekStats } from '../scheduleHelpers'
import { WeekPrintSheet } from './WeekPrintSheet'
import { formatPrintedAt, formatWeekRangeTr, parseWeekParam } from './printHelpers'

export function SchedulePrintPage({ week, auto }: { week?: string; auto?: boolean }) {
  const router = useRouter()
  const { store } = useAuth()
  const currentWeek = useMemo(() => parseWeekParam(week) ?? new Date(), [week])
  const data = useWeeklySchedule(currentWeek, { readOnly: true })
  const { weekDays, employees, assignments, isFirstLoad, error } = data
  const [printedAt] = useState(() => formatPrintedAt(new Date()))

  const entries: WeeklyScheduleEntry[] = useMemo(() => {
    const map = new Map(assignments.map((a) => [`${a.employee_id}:${a.work_date}`, a]))
    return employees
      .map((employee) => ({
        employee,
        dayAssignments: Object.fromEntries(weekDays.map((d) => [d, map.get(`${employee.id}:${d}`) ?? null])),
      }))
      .sort((a, b) =>
        compareRoles(a.employee.roles, b.employee.roles)
        || (a.employee.full_name ?? '').localeCompare(b.employee.full_name ?? '', 'tr'))
  }, [employees, weekDays, assignments])

  const statsMap = useMemo(() => {
    const m = new Map<string, EmployeeWeekStats>()
    for (const e of entries) {
      m.set(e.employee.id, calcEmployeeStats(
        assignments.filter((a) => a.employee_id === e.employee.id), weekDays, e.employee.employment_type ?? 'full_time'))
    }
    return m
  }, [entries, assignments, weekDays])

  const ready = !isFirstLoad && !error
  const autoDone = useRef(false)
  useEffect(() => {
    if (!auto || !ready || autoDone.current) return
    autoDone.current = true
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [auto, ready])

  const go = (d: Date) => router.replace(`/schedule/print?week=${format(d, 'yyyy-MM-dd')}`)

  return (
    <div className="print-root min-h-svh bg-muted/30">
      <div className="print-hide mx-auto flex max-w-[1200px] flex-wrap items-center gap-2 p-4">
        <Button asChild variant="outline">
          <Link href="/schedule"><ArrowLeft /> Plana dön</Link>
        </Button>
        <PeriodStepper
          label={<span className="tabular-nums">{formatWeekRangeTr(weekDays[0], weekDays[6])}</span>}
          onPrev={() => go(subWeeks(currentWeek, 1))}
          onNext={() => go(addWeeks(currentWeek, 1))}
          prevLabel="Önceki hafta"
          nextLabel="Sonraki hafta"
          minLabelWidth={180}
        />
        <Button className="ml-auto" onClick={() => window.print()} disabled={!ready || entries.length === 0}>
          <Printer /> Yazdır
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          Yazdırma penceresinde hedef olarak &quot;PDF olarak kaydet&quot; seçerek PDF alabilirsiniz. Sayfa A4 yatay ayarlanmıştır.
        </p>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 pb-8 print:max-w-none print:p-0">
        {isFirstLoad && !error && <div className="flex justify-center p-10"><Spinner /></div>}
        {error && <p role="alert" className="p-4 text-sm text-destructive">Plan yüklenemedi: {error}</p>}
        {ready && entries.length === 0 && <p className="p-4 text-sm text-muted-foreground">Bu hafta için aktif çalışan bulunamadı.</p>}
        {ready && entries.length > 0 && (
          <div className="bg-white p-4 shadow-sm print:p-0 print:shadow-none">
            <WeekPrintSheet
              storeName={store?.active.name ?? 'Mağaza'}
              weekDays={weekDays}
              entries={entries}
              holidayMap={data.holidayMap}
              statsMap={statsMap}
              approvedLeaveMap={data.approvedLeaveMap}
              restDayMap={data.restDayMap}
              printedAt={printedAt}
            />
          </div>
        )}
      </div>
    </div>
  )
}
