'use client'

/**
 * SchedulePrintPage — /schedule/print?week=YYYY-MM-DD: haftalık planın yazdırılabilir çıktısı.
 * Aynı veri katmanı (useWeeklySchedule) ve aynı rol/mağaza kapsamı kullanılır; ekranda küçük bir araç
 * çubuğu (Yazdır, PDF/CSV indir, hafta gezgini, Plana dön), yazdırırken yalnızca çıktı tablosu görünür.
 * ?auto=1 → veri yüklenince yazdırma penceresi kendiliğinden açılır.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { addWeeks, format, subWeeks } from 'date-fns'
import { ArrowLeft, Printer, TriangleAlert } from 'lucide-react'

import type { WeeklyScheduleEntry } from '@/types/schedule'
import { useAuth } from '@/context/AuthContext'
import { turkeyToday } from '@/lib/dateUtils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ExportMenu, PeriodStepper } from '@/components/common'
import { useWeeklySchedule } from '../useWeeklySchedule'
import { buildScheduleEntries, calcEmployeeStats, type EmployeeWeekStats } from '../scheduleHelpers'
import { WeekPrintSheet } from './WeekPrintSheet'
import { formatPrintedAt, formatWeekRangeTr, parseWeekParam } from './printHelpers'
import { exportWeekCsv, exportWeekPdf, type WeekExportInput } from './weekExport'

export function SchedulePrintPage({ week, auto }: { week?: string; auto?: boolean }) {
  const router = useRouter()
  const { store } = useAuth()
  const parsedWeek = useMemo(() => parseWeekParam(week), [week])
  const invalidWeek = !!week && !parsedWeek
  // Varsayılan hafta Türkiye takvimine göre (sunucu ve istemci aynı günü görsün)
  const currentWeek = useMemo(() => parsedWeek ?? new Date(`${turkeyToday()}T12:00:00`), [parsedWeek])
  const data = useWeeklySchedule(currentWeek, { readOnly: true })
  const { weekDays, employees, assignments, settled, failed } = data
  const [printedAt] = useState(() => formatPrintedAt(new Date()))

  const entries: WeeklyScheduleEntry[] = useMemo(
    () => buildScheduleEntries(employees, assignments, weekDays),
    [employees, weekDays, assignments]
  )

  const statsMap = useMemo(() => {
    const m = new Map<string, EmployeeWeekStats>()
    for (const e of entries) {
      m.set(e.employee.id, calcEmployeeStats(
        assignments.filter((a) => a.employee_id === e.employee.id), weekDays, e.employee.employment_type ?? 'full_time'))
    }
    return m
  }, [entries, assignments, weekDays])

  // Tüm kaynaklar yüklenmeden (veri ya da hata) yazdırılamaz; izin/tatil hatası yalnızca uyarı verir
  const loading = !(settled.assignments && settled.employees && settled.leaves && settled.holidays)
  const error = failed.assignments || failed.employees ? data.error : null
  const partial = failed.leaves || failed.holidays
  const ready = !loading && !error
  const autoDone = useRef(false)
  useEffect(() => {
    if (!auto || !ready || autoDone.current) return
    autoDone.current = true
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [auto, ready])

  const exportInput: WeekExportInput = {
    storeName: store?.active.name ?? '',
    weekDays,
    entries,
    holidayMap: data.holidayMap,
    statsMap,
    approvedLeaveMap: data.approvedLeaveMap,
    restDayMap: data.restDayMap,
  }

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
        <ExportMenu
          className="ml-auto"
          disabled={!ready || entries.length === 0}
          options={[
            { format: 'pdf', run: () => exportWeekPdf(exportInput) },
            { format: 'csv', run: () => exportWeekCsv(exportInput) },
          ]}
        />
        <Button onClick={() => window.print()} disabled={!ready || entries.length === 0}>
          <Printer /> Yazdır
        </Button>
        {invalidWeek && (
          <p role="status" className="w-full text-xs text-muted-foreground">
            Geçersiz hafta bilgisi; bu hafta gösteriliyor.
          </p>
        )}
        {ready && partial && (
          <p role="alert" className="flex w-full items-center gap-1.5 text-xs text-warning">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> İzin/tatil bilgisi yüklenemedi; çıktıda eksik olabilir.
          </p>
        )}
        <p className="w-full text-xs text-muted-foreground">
          PDF ve CSV doğrudan indirilir. Yazdırırken sayfa A4 yatay ayarlanmıştır.
        </p>
      </div>

      <div className="mx-auto max-w-[1200px] px-4 pb-8 print:max-w-none print:p-0">
        {loading && !error && <div className="flex justify-center p-10"><Spinner /></div>}
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
