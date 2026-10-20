'use client'

/**
 * TimesheetPanel — Raporlar › Aylık puantaj.
 *
 * Devam raporuyla aynı dil (DESIGN_GUIDE §9): araç çubuğu (ay, görünüm, arama, Excel) → onay uyarısı →
 * KPI kartları → "Kişiler" (gün şeritli ekip listesi + seçilen kişinin takvim kartı) ya da
 * "Tablo" (çalışan × gün kod matrisi, yapışkan ad sütunu).
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import {
  ArrowRight, CalendarDays, CalendarX2, ChevronLeft, Clock3, Download, Search, Timer, TriangleAlert, UserX,
} from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import { monthDays, TIMESHEET_CODE_LABELS, type TimesheetRow } from '@/lib/timesheet'
import { dayOfWeekFromDateString, turkeyToday } from '@/lib/dateUtils'
import { PeriodStepper, SegmentedControl, StatCard, StatCards, TableSkeleton } from '@/components/common'
import type { PublicHoliday } from '@/types/holiday'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'
import { PEOPLE_GRID, PersonDetailCard, PersonItem, PersonRow, StripAxis, StripLegend } from './TimesheetPeople'
import {
  CALENDAR_TONE, LEGEND_ORDER, hoursLabel, monthLabel, shiftMonth, summarizeTimesheet, type TimesheetKpis,
} from './timesheetSummary'

type View = 'people' | 'table'

const normalize = (s: string) => s.toLocaleLowerCase('tr-TR')

export function TimesheetPanel() {
  const isMobile = useIsMobile()
  const today = turkeyToday()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [view, setView] = useState<View>('people')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Mobil: kişi takvimi açık mı (liste yerine tam ekran detay) */
  const [detailOpen, setDetailOpen] = useState(false)

  const { data, error, isLoading } = useSWR(
    `/api/reports/timesheet?month=${month}`,
    (url: string) => apiFetch<{ rows: TimesheetRow[]; holidays: PublicHoliday[] }>(url)
  )
  const days = monthDays(month)
  const rows = useMemo(() => data?.rows ?? [], [data])
  const kpis = useMemo(() => summarizeTimesheet(rows, month, today), [rows, month, today])
  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return q ? rows.filter((r) => normalize(r.employee.full_name).includes(q)) : rows
  }, [rows, query])
  const selected = rows.find((r) => r.employee.id === selectedId) ?? filtered[0] ?? null
  const monthText = monthLabel(month)
  // Bugün bu ayda değilse şeritte işaretli gün olmaz
  const stripToday = today.startsWith(month) ? today : ''

  const changeMonth = (n: number) => {
    setMonth((m) => shiftMonth(m, n))
    setDetailOpen(false)
  }

  // ── Mobil kişi takvimi ──
  if (isMobile && detailOpen && selected) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" onClick={() => setDetailOpen(false)} className="-ml-2 w-fit">
          <ChevronLeft /> Aylık puantaj
        </Button>
        <PersonDetailCard row={selected} days={days} today={stripToday} monthText={monthText} />
      </div>
    )
  }

  const excelLabel = 'Excel olarak indir'

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* Araç çubuğu: ay · görünüm · arama · Excel */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div className="flex items-center gap-2">
          <PeriodStepper
            label={monthText}
            onPrev={() => changeMonth(-1)}
            onNext={() => changeMonth(1)}
            prevLabel="Önceki ay"
            nextLabel="Sonraki ay"
            minLabelWidth={112}
          />
          {!isMobile && (
            <SegmentedControl
              aria-label="Görünüm"
              value={view}
              onChange={setView}
              options={[{ value: 'people', label: 'Kişiler' }, { value: 'table', label: 'Tablo' }]}
            />
          )}
        </div>
        <InputGroup className="md:w-56">
          <InputGroupInput placeholder="Çalışan ara…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Çalışan ara" />
          <InputGroupAddon><Search /></InputGroupAddon>
        </InputGroup>
        {data ? (
          <Button variant="outline" asChild className="md:ml-auto">
            <a href={`/api/reports/timesheet?month=${month}&format=xlsx`}>
              <Download /> {excelLabel}
            </a>
          </Button>
        ) : (
          <Button variant="outline" disabled className="md:ml-auto"><Download /> {excelLabel}</Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Puantaj yüklenemedi</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : 'Bilinmeyen hata'}</AlertDescription>
        </Alert>
      )}

      {kpis.missingConsent.length > 0 && (
        <Alert tone="warning" role="status" className="md:pr-48">
          <TriangleAlert />
          <AlertTitle>
            {kpis.missingConsent.length === 1
              ? 'Fazla çalışma onayı eksik'
              : `${kpis.missingConsent.length} kişinin fazla çalışma onayı eksik`}
          </AlertTitle>
          <AlertDescription>
            <p>
              <span className="font-medium text-foreground">{kpis.missingConsent.join(', ')}</span>
              {' '}— İş Kanunu Md. 41 gereği yazılı onay gerekir.
            </p>
          </AlertDescription>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="col-start-2 mt-2 w-fit md:absolute md:top-1/2 md:right-4 md:mt-0 md:-translate-y-1/2"
          >
            <Link href="/employees">Çalışanlara git <ArrowRight /></Link>
          </Button>
        </Alert>
      )}

      {isLoading && !data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[124px] rounded-xl" />)}
          </div>
          <TableSkeleton rows={8} columns={6} />
        </>
      ) : data && (
        <>
          <KpiCards kpis={kpis} />

          {rows.length === 0 || filtered.length === 0 ? (
            <div className="rounded-lg border">
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><CalendarX2 /></EmptyMedia>
                  <EmptyTitle>{rows.length === 0 ? 'Puantaj kaydı yok' : 'Eşleşen çalışan yok'}</EmptyTitle>
                  <EmptyDescription>
                    {rows.length === 0 ? `${monthText} için planlanmış vardiya bulunmuyor.` : 'Aramayı değiştirin ya da temizleyin.'}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : view === 'table' && !isMobile ? (
            <CodeTable rows={filtered} days={days} holidays={data.holidays} today={stripToday} />
          ) : isMobile ? (
            <div className="flex flex-col gap-2">
              {filtered.map((r) => (
                <PersonItem
                  key={r.employee.id}
                  row={r}
                  days={days}
                  today={stripToday}
                  onOpen={() => {
                    setSelectedId(r.employee.id)
                    setDetailOpen(true)
                    window.scrollTo({ top: 0 })
                  }}
                />
              ))}
              <div className="px-1 pt-2"><StripLegend today={stripToday} /></div>
            </div>
          ) : (
            <div className="grid items-start gap-4 md:gap-6 @6xl/main:grid-cols-[minmax(0,1fr)_25rem]">
              <Card className="gap-0 overflow-hidden py-0 shadow-xs">
                <CardHeader className="px-6 pt-5 pb-4">
                  <CardTitle>Ekip</CardTitle>
                  <CardDescription>Ayın her günü bir kutu — ayrıntı için kişiyi seçin</CardDescription>
                  <CardAction>
                    <Badge variant="secondary" className="tabular-nums">{filtered.length} çalışan</Badge>
                  </CardAction>
                </CardHeader>
                <div className={cn(PEOPLE_GRID, 'items-end px-6 pb-2 text-xs text-muted-foreground')}>
                  <span>Çalışan</span>
                  <StripAxis days={days} today={stripToday} />
                  <span className="text-right">Net çalışma</span>
                </div>
                <div role="list" aria-label="Ekip puantajı">
                  {filtered.map((r) => (
                    <div role="listitem" key={r.employee.id}>
                      <PersonRow
                        row={r}
                        days={days}
                        today={stripToday}
                        selected={selected?.employee.id === r.employee.id}
                        onSelect={() => setSelectedId(r.employee.id)}
                      />
                    </div>
                  ))}
                </div>
                <div className="border-t bg-muted/40 px-6 py-3">
                  <StripLegend today={stripToday} />
                </div>
              </Card>
              {selected && (
                <PersonDetailCard
                  row={selected}
                  days={days}
                  today={stripToday}
                  monthText={monthText}
                  className="@6xl/main:sticky @6xl/main:top-4"
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── KPI kartları ─────────────────────────────────────────────

function KpiCards({ kpis }: { kpis: TimesheetKpis }) {
  const missing = kpis.missingConsent.length
  return (
    <StatCards>
      <StatCard
        icon={<Clock3 />}
        label="Toplam net çalışma"
        value={`${hoursLabel(kpis.netMins)} s`}
        hint={[`${kpis.people} çalışan`, kpis.daysLeft !== null && `ay sonuna ${kpis.daysLeft} gün`].filter(Boolean).join(' · ')}
      />
      <StatCard
        icon={<Timer />}
        label="Fazla çalışma"
        value={`${hoursLabel(kpis.overtimeMins)} s`}
        hint={kpis.overtimePeople > 0 ? `${kpis.overtimePeople} çalışan · ${missing > 0 ? `${missing} kişide onay eksik` : 'onaylar tamam'}` : 'Fazla çalışma yok'}
      />
      <StatCard
        icon={<UserX />}
        label="Devamsızlık"
        value={`${kpis.absentDays} gün`}
        valueClassName={kpis.absentDays > 0 ? 'text-destructive' : undefined}
        hint={kpis.absentNames.length === 0
          ? 'Devamsızlık yok'
          : kpis.absentNames.slice(0, 3).join(', ') + (kpis.absentNames.length > 3 ? ` +${kpis.absentNames.length - 3}` : '')}
      />
      <StatCard
        icon={<CalendarDays />}
        label="İzin ve rapor"
        value={`${kpis.leaveDays} gün`}
        hint={`${kpis.annualLeaveDays} yıllık izin · ${kpis.sickDays} rapor`}
      />
    </StatCards>
  )
}

// ─── Tablo görünümü: çalışan × gün kodları ────────────────────

const WEEKDAY_INITIALS = ['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct']
const isWeekend = (d: string) => {
  const w = dayOfWeekFromDateString(d)
  return w === 0 || w === 6
}

function CodeTable({ rows, days, holidays: holidayList, today }: {
  rows: TimesheetRow[]; days: string[]; holidays: PublicHoliday[]; today: string
}) {
  const holidays = new Map(holidayList.map((h) => [h.date, h]))
  /** Gün sütunu zemini: resmi tatil > hafta sonu */
  const dayTint = (d: string) => {
    const h = holidays.get(d)
    if (h) return h.half_day ? 'bg-warning/5' : 'bg-warning/10'
    return isWeekend(d) ? 'bg-muted/60' : undefined
  }
  const sticky = 'sticky left-0 after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border'
  const total = 'px-3 text-right tabular-nums'

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {LEGEND_ORDER.map((c) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="w-7 text-center font-semibold" style={{ color: CALENDAR_TONE[c].fg }}>{c}</span>
            {TIMESHEET_CODE_LABELS[c]}
          </span>
        ))}
      </div>

      <div className="max-h-[70dvh] overflow-auto rounded-lg border">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <TableHeader className="sticky top-0 z-20 bg-muted [&_tr]:border-0">
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(sticky, 'z-30 h-12 min-w-48 border-b bg-muted px-4')}>Çalışan</TableHead>
              {days.map((d) => {
                const h = holidays.get(d)
                const head = (
                  <TableHead
                    key={d}
                    className={cn(
                      'h-12 w-9 min-w-9 border-b px-0 text-center leading-tight',
                      dayTint(d),
                      d === today && 'text-primary'
                    )}
                  >
                    <span className="block tabular-nums">{Number(d.slice(8))}</span>
                    <span className={cn('block text-xs font-normal', d === today ? 'text-primary' : 'text-muted-foreground')}>
                      {WEEKDAY_INITIALS[dayOfWeekFromDateString(d)]}
                    </span>
                  </TableHead>
                )
                return h ? (
                  <Tooltip key={d}>
                    <TooltipTrigger asChild>{head}</TooltipTrigger>
                    <TooltipContent>{h.name}{h.half_day ? ' (yarım gün)' : ''}</TooltipContent>
                  </Tooltip>
                ) : head
              })}
              <TableHead className={cn(total, 'border-b border-l')}>Net s</TableHead>
              <TableHead className={cn(total, 'border-b')}>Fazla s</TableHead>
              <TableHead className={cn(total, 'border-b')}>Gece s</TableHead>
              <TableHead className={cn(total, 'border-b')}>RT gün</TableHead>
              <TableHead className={cn(total, 'border-b')}>SGK</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr:last-child_td]:border-b-0">
            {rows.map((r) => (
              <TableRow key={r.employee.id} className="group border-0 hover:bg-transparent">
                <TableCell className={cn(sticky, 'z-10 h-10 border-b bg-background px-4 font-medium group-hover:bg-muted')}>
                  <span className="block max-w-56 truncate">{r.employee.full_name}</span>
                </TableCell>
                {days.map((d) => {
                  const code = r.days[d] ?? ''
                  return (
                    <TableCell
                      key={d}
                      title={code ? `${Number(d.slice(8))}: ${TIMESHEET_CODE_LABELS[code]}` : undefined}
                      className={cn('h-10 border-b px-0 text-center text-xs font-semibold group-hover:bg-muted', dayTint(d))}
                      style={{ color: CALENDAR_TONE[code].fg }}
                    >
                      {code}
                    </TableCell>
                  )
                })}
                <TableCell className={cn(total, 'border-b border-l font-medium group-hover:bg-muted')}>{hoursLabel(r.workedMins)}</TableCell>
                <TableCell className={cn(total, 'border-b group-hover:bg-muted')}>
                  {r.overtimeMins > 0 ? (
                    r.overtimeWithoutConsent
                      ? <Badge tone="warning" title="Yazılı onay yok">{hoursLabel(r.overtimeMins)}</Badge>
                      : hoursLabel(r.overtimeMins)
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className={cn(total, 'border-b group-hover:bg-muted')}>
                  {r.nightMins > 0 ? hoursLabel(r.nightMins) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className={cn(total, 'border-b group-hover:bg-muted')}>
                  {r.holidayWorkedDays || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className={cn(total, 'border-b group-hover:bg-muted')}>{r.sgkDays}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-xs border bg-warning/10" />
          Resmi tatil (üzerine gelince adı görünür)
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-xs border bg-muted" />
          Hafta sonu
        </span>
      </p>
    </div>
  )
}
