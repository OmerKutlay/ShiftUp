'use client'

import useSWR from 'swr'
import { AlertCircle, Info, Loader2, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { DailyShiftEntry } from '@/types/attendance'
import { fetchDailyShifts } from '@/lib/api/attendance'
import { EmployeeAttendanceRow } from './EmployeeAttendanceRow'
import { formatDateTurkish, formatDayNameTurkish } from '@/lib/dateUtils'
import { PageHeader, StatCardsSkeleton, ListSkeleton, SectionCard, StatCard, StatGrid } from '@/components/common'
import { useLastUpdated } from '@/hooks/useLastUpdated'
import { C } from '@/lib/palette'

export function DailyAttendancePage() {
  const today = new Date()
  const { data, error: loadError, isValidating: loading, mutate } = useSWR('attendance:daily', fetchDailyShifts)
  const entries: DailyShiftEntry[] = data?.entries ?? []
  const isFirstLoad = !data && !loadError
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Vardiyalar yüklenemedi.') : null
  const lastRefreshed = useLastUpdated(data)
  const loadShifts = () => mutate()

  // Stats
  const workingCount = entries.filter(
    (e) =>
      e.attendanceRecord?.status === 'working' ||
      e.attendanceRecord?.status === 'working_after_break'
  ).length
  const onBreakCount = entries.filter((e) => e.attendanceRecord?.status === 'on_break').length
  const clockedOutCount = entries.filter(
    (e) => e.attendanceRecord?.status === 'clocked_out'
  ).length

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        overline={formatDayNameTurkish(today)}
        title="Günlük operasyon"
        subtitle={formatDateTurkish(today)}
        meta={lastRefreshed && `Son güncelleme: ${lastRefreshed.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`}
        actions={
          /* FAZ 8: Manual refresh button */
          <Button variant="outline" onClick={() => void loadShifts()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Yenile
          </Button>
        }
      />

      {/* Stats row */}
      {isFirstLoad && <StatCardsSkeleton count={4} />}
      {!isFirstLoad && !error && (
        <StatGrid min={140}>
          <StatCard label="Toplam vardiya" value={entries.length} />
          <StatCard label="Çalışıyor" value={workingCount} valueColor={C.success} />
          <StatCard label="Molada" value={onBreakCount} valueColor={onBreakCount ? C.warning : undefined} />
          <StatCard label="Çıkış yaptı" value={clockedOutCount} />
        </StatGrid>
      )}

      {/* Content */}
      {isFirstLoad && <ListSkeleton count={5} actions={2} />}

      {error && (
        <Alert tone="danger">
          <AlertCircle />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-ink">
            {error}
            <Button variant="ghost" size="sm" onClick={() => void loadShifts()}>Tekrar Dene</Button>
          </AlertDescription>
        </Alert>
      )}

      {!isFirstLoad && !error && entries.length === 0 && (
        <Alert tone="info">
          <Info />
          <AlertDescription className="text-ink">Bugün için planlanmış vardiya bulunamadı.</AlertDescription>
        </Alert>
      )}

      {entries.length > 0 && (
        <SectionCard title="Bugünkü vardiyalar" count={entries.length} subtitle="Giriş, mola ve çıkış QR okutmayla işlenir">
          {entries.map((entry) => (
            <EmployeeAttendanceRow key={entry.shiftAssignment.id} entry={entry} />
          ))}
        </SectionCard>
      )}
    </div>
  )
}
