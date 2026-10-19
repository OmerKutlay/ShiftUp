'use client'

/**
 * TimesheetPanel — aylık puantaj: KPI kartları, kişi şeritleri + takvim detayı ("Kişiler")
 * ya da çalışan × gün kod tablosu ("Tablo"), Excel indirme.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { AlertCircle, ChevronLeft, Download, Search, TriangleAlert } from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import { monthDays, TIMESHEET_CODE_LABELS, type TimesheetCode, type TimesheetRow } from '@/lib/timesheet'
import { turkeyToday } from '@/lib/dateUtils'
import { PeriodStepper, SegmentedControl, StatCard, TableSkeleton } from '@/components/common'
import type { PublicHoliday } from '@/types/holiday'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'
import { PersonCard, PersonDetail, PersonRow, PEOPLE_GRID, StripAxis, StripLegend } from './TimesheetPeople'
import { hoursLabel, monthLabel, shiftMonth, summarizeTimesheet, type TimesheetKpis } from './timesheetSummary'

// Yeni UI puantaj lejantı: çalıştı yeşil, resmi tatilde çalıştı kiremit, devamsız kırmızı …
const CODE_COLOR: Partial<Record<TimesheetCode, string>> = {
  'Ç': 'text-success',
  'RTÇ': 'text-brand',
  'HT': 'text-ink-muted',
  'RT': 'text-warning',
  'Yİ': 'text-info',
  'Rİ': 'text-plum',
  'Üİ': 'text-ink-muted',
  'Mİ': 'text-plum',
  'D': 'text-danger',
  'P': 'text-neutral',
}

type View = 'people' | 'table'

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
    const q = query.trim().toLocaleLowerCase('tr-TR')
    return q ? rows.filter((r) => r.employee.full_name.toLocaleLowerCase('tr-TR').includes(q)) : rows
  }, [rows, query])
  const selected = rows.find((r) => r.employee.id === selectedId) ?? filtered[0] ?? null
  const monthText = monthLabel(month)
  // Bugün bu ayda değilse şeritte çerçeveli gün olmaz
  const stripToday = today.startsWith(month) ? today : ''

  const changeMonth = (n: number) => {
    setMonth((m) => shiftMonth(m, n))
    setDetailOpen(false)
  }

  // ── Mobil kişi takvimi ──
  if (isMobile && detailOpen && selected) {
    return (
      <div>
        <Button variant="ghost" onClick={() => setDetailOpen(false)} className="mb-3 -ml-2 text-[0.95rem]">
          <ChevronLeft className="size-5" /> Aylık puantaj
        </Button>
        <div className="rounded-2xl border bg-card p-4">
          <PersonDetail row={selected} days={days} today={stripToday} monthText={monthText} compact />
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Araç çubuğu */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PeriodStepper
          label={monthText}
          onPrev={() => changeMonth(-1)}
          onNext={() => changeMonth(1)}
          prevLabel="Önceki ay"
          nextLabel="Sonraki ay"
          minLabelWidth={110}
        />
        {!isMobile && (
          <SegmentedControl
            aria-label="Görünüm"
            value={view}
            onChange={setView}
            options={[{ value: 'people', label: 'Kişiler' }, { value: 'table', label: 'Tablo' }]}
          />
        )}
        <span className="flex-1" />
        {data ? (
          <Button asChild>
            <a href={`/api/reports/timesheet?month=${month}&format=xlsx`}>
              <Download /> {isMobile ? 'Excel' : 'Excel olarak indir'}
            </a>
          </Button>
        ) : (
          <Button disabled><Download /> {isMobile ? 'Excel' : 'Excel olarak indir'}</Button>
        )}
      </div>

      {error && (
        <Alert tone="danger" className="mb-4">
          <AlertCircle />
          <AlertDescription className="text-ink">{error instanceof Error ? error.message : 'Puantaj yüklenemedi.'}</AlertDescription>
        </Alert>
      )}

      {kpis.missingConsent.length > 0 && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-2.5 rounded-xl bg-warning-soft px-4 py-2.5 text-[0.8rem]">
          <TriangleAlert className="size-4 shrink-0 text-warning" />
          <p className="min-w-[200px] flex-1">
            {isMobile ? (
              <b>{kpis.missingConsent.length} kişinin fazla çalışma onayı eksik</b>
            ) : (
              <>
                <b>Fazla çalışma onayı eksik:</b> {kpis.missingConsent.join(', ')} — İş Kanunu Md. 41 gereği yazılı onay gerekir.
              </>
            )}
          </p>
          {!isMobile && (
            <Link href="/employees" className="font-bold hover:underline">Çalışanlara git →</Link>
          )}
        </div>
      )}

      {isLoading && !data && <TableSkeleton rows={6} />}

      {data && (
        <>
          <KpiCards kpis={kpis} isMobile={isMobile} />

          {view === 'table' && !isMobile ? (
            <CodeTable rows={filtered} days={days} holidays={data.holidays} />
          ) : isMobile ? (
            <div className="flex flex-col gap-2.5">
              {filtered.map((r) => (
                <PersonCard
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
            </div>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
              <section className="overflow-hidden rounded-2xl border bg-card">
                <div className="flex items-center gap-3 px-4 pt-3.5 pb-2">
                  <h2 className="text-[0.9rem] font-bold">Ekip</h2>
                  <span className="flex-1 text-xs text-ink-secondary">Ayın her günü bir kutu</span>
                  <div className="relative w-56">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Çalışan ara…"
                      aria-label="Çalışan ara"
                      className="h-9 pl-8 text-[0.8rem]"
                    />
                  </div>
                </div>
                <div className={cn(PEOPLE_GRID, 'px-4 pb-1')}>
                  <span />
                  <StripAxis days={days} today={stripToday} />
                  <span />
                </div>
                {filtered.map((r) => (
                  <PersonRow
                    key={r.employee.id}
                    row={r}
                    days={days}
                    today={stripToday}
                    selected={selected?.employee.id === r.employee.id}
                    onSelect={() => setSelectedId(r.employee.id)}
                  />
                ))}
                {filtered.length === 0 && (
                  <p className="border-t px-4 py-6 text-sm text-ink-secondary">Eşleşen çalışan yok.</p>
                )}
                <div className="border-t px-4 py-3">
                  <StripLegend today={today} />
                </div>
              </section>
              {selected && (
                <section className="rounded-2xl border bg-card p-4 lg:sticky lg:top-4">
                  <PersonDetail row={selected} days={days} today={stripToday} monthText={monthText} />
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── KPI kartları ─────────────────────────────────────────────

function KpiCards({ kpis, isMobile }: { kpis: TimesheetKpis; isMobile: boolean }) {
  const consentNote = kpis.missingConsent.length > 0 ? `${kpis.missingConsent.length} kişide onay eksik` : 'onaylar tamam'
  const cards = [
    {
      label: isMobile ? 'Net çalışma' : 'Toplam net çalışma',
      value: `${hoursLabel(kpis.netMins)} s`,
      note: isMobile
        ? `${kpis.people} çalışan`
        : [`${kpis.people} çalışan`, kpis.daysLeft !== null && `ay sonuna ${kpis.daysLeft} gün`].filter(Boolean).join(' · '),
    },
    {
      label: 'Fazla çalışma',
      value: `${hoursLabel(kpis.overtimeMins)} s`,
      note: isMobile ? consentNote : `${kpis.overtimePeople} çalışan · ${consentNote}`,
    },
    {
      label: 'Devamsızlık',
      value: `${kpis.absentDays} gün`,
      note: kpis.absentNames.length === 0
        ? 'devamsızlık yok'
        : kpis.absentNames.slice(0, 3).join(', ') + (kpis.absentNames.length > 3 ? ` +${kpis.absentNames.length - 3}` : ''),
    },
    {
      label: 'İzin ve rapor',
      value: `${kpis.leaveDays} gün`,
      note: `${kpis.annualLeaveDays} yıllık izin · ${kpis.sickDays} rapor`,
    },
  ]
  const shown = isMobile ? cards.slice(0, 2) : cards
  return (
    <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-4">
      {shown.map((c) => <StatCard key={c.label} label={c.label} value={c.value} note={c.note} />)}
    </div>
  )
}

// ─── Tablo görünümü: çalışan × gün kodları ────────────────────

function CodeTable({ rows, days, holidays: holidayList }: { rows: TimesheetRow[]; days: string[]; holidays: PublicHoliday[] }) {
  const holidays = new Map(holidayList.map((h) => [h.date, h]))
  return (
    <>
      <p className="mb-2 text-xs text-ink-secondary">
        Kodlar: {Object.entries(TIMESHEET_CODE_LABELS).map(([k, v]) => `${k} ${v}`).join(' · ')}
      </p>
      <div className="max-h-[70dvh] overflow-auto rounded-2xl border bg-card">
        <Table className="[&_td]:border-b">
          <TableHeader className="sticky top-0 z-[2] bg-card">
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky left-0 z-[3] min-w-40 bg-card">Çalışan</TableHead>
              {days.map((d) => {
                const h = holidays.get(d)
                const cell = (
                  <TableHead key={d} className={cn('min-w-[34px] px-1 text-center', h && !h.half_day && 'bg-warning-soft')}>
                    {Number(d.slice(8))}
                  </TableHead>
                )
                return h ? (
                  <Tooltip key={d}>
                    <TooltipTrigger asChild>{cell}</TooltipTrigger>
                    <TooltipContent>{h.name}</TooltipContent>
                  </Tooltip>
                ) : cell
              })}
              <TableHead className="text-right">Net s</TableHead>
              <TableHead className="text-right">Fazla s</TableHead>
              <TableHead className="text-right">Gece s</TableHead>
              <TableHead className="text-right">RT gün</TableHead>
              <TableHead className="text-right">SGK</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.employee.id}>
                <TableCell className="sticky left-0 min-w-40 bg-card font-semibold">{r.employee.full_name}</TableCell>
                {days.map((d) => {
                  const code = r.days[d] ?? ''
                  return (
                    <TableCell key={d} className={cn('px-0.5 text-center text-[0.7rem] font-bold', CODE_COLOR[code])}>
                      {code}
                    </TableCell>
                  )
                })}
                <TableCell className="text-right">{hoursLabel(r.workedMins)}</TableCell>
                <TableCell className="text-right">
                  {r.overtimeMins > 0 ? (
                    <Badge tone={r.overtimeWithoutConsent ? 'warning' : 'neutral'} className="h-5">{hoursLabel(r.overtimeMins)}</Badge>
                  ) : '—'}
                </TableCell>
                <TableCell className="text-right">{r.nightMins > 0 ? hoursLabel(r.nightMins) : '—'}</TableCell>
                <TableCell className="text-right">{r.holidayWorkedDays || '—'}</TableCell>
                <TableCell className="text-right">{r.sgkDays}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
