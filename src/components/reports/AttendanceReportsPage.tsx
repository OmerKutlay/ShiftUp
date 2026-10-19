'use client'

import { useState, useCallback } from 'react'
import {
  AlertCircle, BarChart3, CheckCircle2, ChevronDown, Download, Info, Loader2, Search, SquarePen, TriangleAlert, X,
} from 'lucide-react'
import type { EmployeeWithRole } from '@/types/employee'
import type { AttendanceReportRow, AttendanceReportSummary, ManualAttendanceOverride } from '@/types/report'
import {
  fetchAttendanceReport,
  buildReportSummary,
  exportReportToCsv,
} from '@/lib/reportRepository'
import { fetchEmployees } from '@/lib/api/employees'
import { format, subDays } from 'date-fns'
import { tr } from 'date-fns/locale'
import {
  DateField, EmployeeSelect, PageHeader, PersonAvatar, StatCard, StatGrid, TableSkeleton,
} from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { shiftKindOf } from '@/components/schedule/scheduleHelpers'
import { isKioskRole } from '@/lib/auth/roles'
import { useIsMobile } from '@/hooks/useIsMobile'
import { C, SHIFT_KIND_TONES } from '@/lib/palette'
import { cn } from '@/lib/utils'

const STATUS_LABELS: Record<string, string> = {
  shift_waiting: 'Gelmedi',
  working: 'Çalışıyor',
  on_break: 'Molada',
  working_after_break: 'Çalışıyor',
  clocked_out: 'Çıkış yaptı',
  on_leave: 'İzinli',
  upcoming: 'Başlamadı',
}

const STATUS_TONES: Record<string, BadgeTone> = {
  shift_waiting: 'danger',
  working: 'success',
  on_break: 'warning',
  working_after_break: 'success',
  clocked_out: 'plum',
  on_leave: 'info',
  upcoming: 'neutral',
}

function formatMinutes(mins: number | null): string {
  if (mins === null) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}s ${m}d`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return '—'
  }
}

/** "10 Eki 2026, Cts" biçimi */
function formatDateTr(workDate: string): string {
  try {
    return format(new Date(`${workDate}T12:00:00`), 'd MMM yyyy, EEE', { locale: tr })
  } catch {
    return workDate
  }
}

const rowKey = (row: AttendanceReportRow, i: number) => `${row.employee_id}-${row.work_date}-${i}`

// ─── Küçük parçalar ──────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{STATUS_LABELS[status] ?? status}</Badge>
}

/** Vardiya adı + saatleri — vardiya türü rengiyle (Açılış sarı, Ortacı şeftali, Kapanış mor) */
function ShiftChip({ row }: { row: AttendanceReportRow }) {
  const start = row.start_time.slice(0, 5)
  const end = row.end_time.slice(0, 5)
  const tone = SHIFT_KIND_TONES[shiftKindOf(row.shift_name ?? undefined, start, end)]
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-semibold tabular-nums"
      style={{ backgroundColor: tone.soft, color: tone.text }}
    >
      {row.shift_name && <span>{row.shift_name}</span>}
      <span>{start}–{end}</span>
    </span>
  )
}

function ExceptionNote({ note }: { note: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={`Not: ${note}`} className="inline-flex size-6 items-center justify-center rounded-md text-warning hover:bg-warning-soft">
          <TriangleAlert className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  )
}

function OverrideButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Manuel düzelt" title="Manuel düzelt"
      className="text-ink-muted hover:text-primary" onClick={onClick}>
      <SquarePen />
    </Button>
  )
}

/** Çalışan başına özet satırı (ad + satır içi istatistikler + net çalışma) */
function SummaryLine({ s }: { s: AttendanceReportSummary }) {
  const stat = (label: string, value: React.ReactNode, cls?: string) => (
    <span>{label} <b className={cn('font-semibold text-ink', cls)}>{value}</b></span>
  )
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <PersonAvatar name={s.full_name} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{s.full_name}</p>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-secondary">
          {stat('Vardiya', s.total_shifts)}
          {stat('Katılım', `${s.attended_shifts}/${s.expected_shifts}`)}
          {stat('Tamamlanan', s.clocked_out_count, 'text-plum')}
          {stat('Gelmedi', s.no_show_count, s.no_show_count > 0 ? 'text-danger' : undefined)}
          {s.on_leave_count > 0 && stat('İzinli', s.on_leave_count, 'text-info')}
          {s.upcoming_count > 0 && stat('Başlamadı', s.upcoming_count, 'text-ink-muted')}
        </p>
      </div>
      <span className="shrink-0 text-sm font-bold tabular-nums text-success">{formatMinutes(s.total_worked_minutes)}</span>
    </li>
  )
}

// ─── Override Dialog ─────────────────────────────────────────

interface OverrideDialogProps {
  open: boolean
  row: AttendanceReportRow | null
  onClose: () => void
  onSave: (override: ManualAttendanceOverride) => Promise<void>
  saving: boolean
}

function OverrideDialog({ open, row, onClose, onSave, saving }: OverrideDialogProps) {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Form her açılışta sıfırlanır — üst bileşen key ile yeniden mount eder
  const recordId = row?.record_id ?? null

  const handleSave = async () => {
    if (!recordId) {
      setError('Attendance kaydı bulunamadı — yalnızca mevcut kayıtlar düzenlenebilir.')
      return
    }
    if (!note.trim()) {
      setError('Override sebebini belirtmelisiniz.')
      return
    }
    setError(null)
    try {
      await onSave({ record_id: recordId, exception_note: note })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Override başarısız.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manuel düzeltme</DialogTitle>
          {row && (
            <DialogDescription>
              <strong className="font-semibold text-ink">{row.full_name}</strong> — {formatDateTr(row.work_date)}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="grid gap-3">
          {error && (
            <Alert tone="danger">
              <AlertCircle />
              <AlertDescription className="text-ink">{error}</AlertDescription>
            </Alert>
          )}
          {!recordId && !error && (
            <Alert tone="info">
              <Info />
              <AlertDescription className="text-ink">Bu çalışanın bu tarihe ait attendance kaydı bulunamadı.</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="override-note">Override sebebi *</Label>
            <Textarea
              id="override-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Örn: Sistem hatası nedeniyle manuel düzeltme yapıldı."
              disabled={!recordId}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>İptal</Button>
          <Button onClick={() => void handleSave()} disabled={saving || !recordId || !note.trim()}>
            {saving && <Loader2 className="animate-spin" />}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Page ───────────────────────────────────────────────

/** embedded: sekmeli Raporlar sayfasının içinde (başlık ve sayfa dolgusu olmadan) */
export function AttendanceReportsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const isMobile = useIsMobile()
  const today = format(new Date(), 'yyyy-MM-dd')
  const weekAgo = format(subDays(new Date(), 6), 'yyyy-MM-dd')

  const [employees, setEmployees] = useState<EmployeeWithRole[]>([])
  const [employeesLoaded, setEmployeesLoaded] = useState(false)

  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [dateFrom, setDateFrom] = useState(weekAgo)
  const [dateTo, setDateTo] = useState(today)

  const [rows, setRows] = useState<AttendanceReportRow[]>([])
  const [summaries, setSummaries] = useState<AttendanceReportSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  // Özet bölümü: kullanıcı seçmediyse masaüstünde açık, mobilde kapalı
  const [summaryOpenPref, setSummaryOpenPref] = useState<boolean | null>(null)
  const summaryOpen = summaryOpenPref ?? !isMobile

  // Override dialog
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideRow, setOverrideRow] = useState<AttendanceReportRow | null>(null)
  const [overrideKey, setOverrideKey] = useState(0)
  const [overrideSaving, setOverrideSaving] = useState(false)
  const [overrideSuccess, setOverrideSuccess] = useState<string | null>(null)

  // Load employees lazily when filter is opened
  const ensureEmployees = useCallback(async () => {
    if (employeesLoaded) return
    try {
      const emps = await fetchEmployees()
      setEmployees(emps.filter((e) => !isKioskRole(e.roles?.name)))
      setEmployeesLoaded(true)
    } catch {
      // non-critical
    }
  }, [employeesLoaded])

  const handleSearch = useCallback(async () => {
    if (!dateFrom || !dateTo) {
      setError('Başlangıç ve bitiş tarihi zorunludur.')
      return
    }
    if (dateFrom > dateTo) {
      setError('Başlangıç tarihi bitiş tarihinden sonra olamaz.')
      return
    }

    setLoading(true)
    setError(null)
    setHasSearched(true)

    try {
      const data = await fetchAttendanceReport({
        employee_id: selectedEmployee || undefined,
        date_from: dateFrom,
        date_to: dateTo,
      })
      setRows(data)
      setSummaries(buildReportSummary(data))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rapor yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, selectedEmployee])

  const handleExport = () => {
    const csv = exportReportToCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `shiftup-attendance-${dateFrom}-${dateTo}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const openOverride = (row: AttendanceReportRow) => {
    setOverrideRow(row)
    setOverrideKey((k) => k + 1)
    setOverrideOpen(true)
    setOverrideSuccess(null)
  }

  const handleOverrideSave = async (override: ManualAttendanceOverride) => {
    setOverrideSaving(true)
    try {
      const res = await fetch('/api/attendance/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(override),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        throw new Error(data.error ?? 'Override başarısız.')
      }
      setOverrideOpen(false)
      setOverrideSuccess(`${overrideRow?.full_name} kaydı güncellendi.`)
      // Raporu yenile
      await handleSearch()
    } finally {
      setOverrideSaving(false)
    }
  }

  // Genel toplamlar (KPI kartları)
  const totals = summaries.reduce(
    (t, s) => ({
      shifts: t.shifts + s.total_shifts,
      attended: t.attended + s.attended_shifts,
      expected: t.expected + s.expected_shifts,
      done: t.done + s.clocked_out_count,
      noShow: t.noShow + s.no_show_count,
      worked: t.worked + s.total_worked_minutes,
    }),
    { shifts: 0, attended: 0, expected: 0, done: 0, noShow: 0, worked: 0 }
  )

  return (
    <div className={cn('grid gap-4', !embedded && 'p-4 md:p-6')}>
      {!embedded && (
        <PageHeader
          title="Devam raporları"
          subtitle="Tarih aralığı ve çalışana göre filtreleyerek rapor oluşturun"
        />
      )}

      {/* Filtreler */}
      <section className="rounded-2xl border bg-card p-3 md:p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
          <div className="lg:w-[200px]">
            <DateField
              label="Başlangıç tarihi"
              value={dateFrom}
              onChange={setDateFrom}
              max={dateTo || undefined}
              size="small"
              fullWidth
            />
          </div>
          <div className="lg:w-[200px]">
            <DateField
              label="Bitiş tarihi"
              value={dateTo}
              onChange={setDateTo}
              min={dateFrom || undefined}
              size="small"
              fullWidth
            />
          </div>
          <div className="sm:col-span-2 lg:w-[240px]">
            <EmployeeSelect
              employees={employees}
              value={selectedEmployee}
              label="Çalışan (opsiyonel)"
              emptyLabel="Tüm çalışanlar"
              onChange={setSelectedEmployee}
              onOpen={ensureEmployees}
              fullWidth
            />
          </div>
          <div className="flex gap-2 sm:col-span-2 lg:ml-auto">
            <Button onClick={() => void handleSearch()} disabled={loading} className="flex-1 lg:flex-none">
              {loading ? <Loader2 className="animate-spin" /> : <Search />}
              Rapor getir
            </Button>
            {rows.length > 0 && (
              <Button variant="outline" onClick={handleExport} className="flex-1 lg:flex-none">
                <Download />
                CSV indir
              </Button>
            )}
          </div>
        </div>
      </section>

      {error && (
        <Alert tone="danger">
          <AlertCircle />
          <AlertDescription className="text-ink">{error}</AlertDescription>
        </Alert>
      )}
      {overrideSuccess && (
        <Alert tone="success" className="pr-12">
          <CheckCircle2 />
          <AlertDescription className="text-ink">{overrideSuccess}</AlertDescription>
          <button type="button" aria-label="Kapat" onClick={() => setOverrideSuccess(null)}
            className="absolute top-2 right-2 inline-flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-card/60">
            <X className="size-4" />
          </button>
        </Alert>
      )}

      {/* Özet */}
      {summaries.length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-card">
          <button
            type="button"
            aria-expanded={summaryOpen}
            aria-controls="report-summary"
            onClick={() => setSummaryOpenPref(!summaryOpen)}
            className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left outline-none hover:bg-muted/60 focus-visible:bg-muted"
          >
            <h2 className="text-[0.95rem] font-bold">Özet istatistikler</h2>
            <span className="text-[0.78rem] text-ink-secondary">{summaries.length} çalışan</span>
            <span className="flex-1" />
            <ChevronDown className={cn('size-4 text-ink-secondary transition-transform', summaryOpen && 'rotate-180')} />
          </button>
          {summaryOpen && (
            <div id="report-summary" className="border-t">
              <div className="p-3 md:p-4">
                <StatGrid min={140} className="mb-0 md:mb-0">
                  <StatCard label="Toplam vardiya" value={totals.shifts} />
                  <StatCard label="Katılım" value={`${totals.attended}/${totals.expected}`} />
                  <StatCard label="Tamamlanan" value={totals.done} valueColor={C.plum} />
                  <StatCard label="Gelmedi" value={totals.noShow} valueColor={totals.noShow > 0 ? C.danger : undefined} />
                  <StatCard label="Net çalışma" value={formatMinutes(totals.worked)} valueColor={C.success} />
                </StatGrid>
              </div>
              <ul className="border-t [&>li+li]:border-t">
                {summaries.map((s) => <SummaryLine key={s.employee_id} s={s} />)}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Detay listesi */}
      {loading && <TableSkeleton rows={8} columns={8} />}
      {hasSearched && !loading && (
        rows.length === 0 ? (
          <Alert tone="info">
            <Info />
            <AlertDescription className="text-ink">Seçili tarih aralığında veri bulunamadı.</AlertDescription>
          </Alert>
        ) : (
          <section className="overflow-hidden rounded-2xl border bg-card">
            <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
              <h2 className="text-[0.95rem] font-bold">Detay listesi</h2>
              <span className="text-[0.78rem] text-ink-secondary">{rows.length} kayıt</span>
            </div>

            {/* Mobil: yığılmış satırlar */}
            <ul className="border-t md:hidden [&>li+li]:border-t">
              {rows.map((row, i) => (
                <li key={rowKey(row, i)} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{row.full_name}</p>
                      <p className="text-xs text-ink-secondary">{formatDateTr(row.work_date)}</p>
                    </div>
                    <StatusChip status={row.status} />
                    {row.record_id && <OverrideButton onClick={() => openOverride(row)} />}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <ShiftChip row={row} />
                    <span className="tabular-nums">Giriş {formatTime(row.clock_in_at)}</span>
                    <span className="tabular-nums">Çıkış {formatTime(row.clock_out_at)}</span>
                    <span className={cn('font-semibold tabular-nums', row.worked_minutes ? 'text-success' : 'text-ink-muted')}>
                      Net {formatMinutes(row.worked_minutes)}
                    </span>
                    <span className="text-ink-muted">Doğrulama: {row.verification_method ?? '—'}</span>
                  </div>
                  {row.exception_note && (
                    <p className="mt-1.5 flex items-start gap-1 text-xs text-warning">
                      <TriangleAlert className="mt-px size-3.5 shrink-0" />
                      <span className="[overflow-wrap:anywhere]">{row.exception_note}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>

            {/* Masaüstü: tablo */}
            <div className="hidden border-t md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Çalışan</TableHead>
                    <TableHead>Tarih</TableHead>
                    <TableHead>Vardiya</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Giriş</TableHead>
                    <TableHead>Çıkış</TableHead>
                    <TableHead>Net çalışma</TableHead>
                    <TableHead>Doğrulama</TableHead>
                    <TableHead className="w-12"><span className="sr-only">İşlem</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={rowKey(row, i)}>
                      <TableCell className="font-semibold">{row.full_name}</TableCell>
                      <TableCell className="text-ink-secondary">{formatDateTr(row.work_date)}</TableCell>
                      <TableCell><ShiftChip row={row} /></TableCell>
                      <TableCell><StatusChip status={row.status} /></TableCell>
                      <TableCell className="tabular-nums">{formatTime(row.clock_in_at)}</TableCell>
                      <TableCell className="tabular-nums">{formatTime(row.clock_out_at)}</TableCell>
                      <TableCell className={cn('font-semibold tabular-nums', row.worked_minutes ? 'text-success' : 'text-ink-muted')}>
                        {formatMinutes(row.worked_minutes)}
                      </TableCell>
                      <TableCell className="text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          {row.verification_method ?? '—'}
                          {row.exception_note && <ExceptionNote note={row.exception_note} />}
                        </span>
                      </TableCell>
                      <TableCell className="py-1 text-right">
                        {row.record_id && <OverrideButton onClick={() => openOverride(row)} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        )
      )}

      {!hasSearched && !loading && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-ink-muted">
          <BarChart3 className="size-10 opacity-50" aria-hidden />
          <p className="text-sm text-ink-secondary">Rapor getirmek için filtre doldurun ve arayın.</p>
        </div>
      )}

      {/* Override Dialog */}
      <OverrideDialog
        key={overrideKey}
        open={overrideOpen}
        row={overrideRow}
        onClose={() => setOverrideOpen(false)}
        onSave={handleOverrideSave}
        saving={overrideSaving}
      />
    </div>
  )
}
