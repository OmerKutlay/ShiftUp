'use client'

/**
 * OvertimePanel — yıllık fazla çalışma takibi (İş K. Md. 41): 270 saat sınırı ve yazılı onay.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { apiFetch } from '@/lib/api/http'
import type { OvertimeSummary } from '@/lib/overtime'
import { ANNUAL_OVERTIME_CAP_HOURS } from '@/lib/laborLaw'
import { formatShortDateTr, turkeyToday } from '@/lib/dateUtils'
import { PersonAvatar, StatusBadge, TableSkeleton } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const hours = (mins: number) => (Math.round((mins / 60) * 10) / 10).toLocaleString('tr-TR')

export function OvertimePanel() {
  const currentYear = Number(turkeyToday().slice(0, 4))
  const [year, setYear] = useState(currentYear)
  const { data, error, isLoading } = useSWR(`/api/reports/overtime?year=${year}`, (url: string) =>
    apiFetch<{ summaries: OvertimeSummary[] }>(url)
  )
  const rows = (data?.summaries ?? []).filter((s) => s.totalOvertimeMins > 0)

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Label htmlFor="overtime-year" className="text-ink-secondary">Yıl</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger id="overtime-year" className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-ink-secondary">
          Haftalık 45 saati aşan net fiili çalışma fazla çalışmadır; yıllık üst sınır {ANNUAL_OVERTIME_CAP_HOURS} saat,
          ücreti %50 zamlıdır ve çalışanın yazılı onayı gerekir.
        </p>
      </div>

      {error && (
        <Alert tone="danger">
          <AlertCircle />
          <AlertDescription className="text-ink">{error instanceof Error ? error.message : 'Rapor yüklenemedi.'}</AlertDescription>
        </Alert>
      )}
      {isLoading && !data && <TableSkeleton rows={5} />}
      {data && rows.length === 0 && (
        <Alert tone="success">
          <CheckCircle2 />
          <AlertDescription className="text-ink">{year} yılında fazla çalışma kaydı yok.</AlertDescription>
        </Alert>
      )}

      {rows.length > 0 && (
        <section className="overflow-hidden rounded-2xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Çalışan</TableHead>
                <TableHead className="text-right">Fazla çalışma (s)</TableHead>
                <TableHead className="min-w-[180px]">Yıllık sınır ({ANNUAL_OVERTIME_CAP_HOURS} s)</TableHead>
                <TableHead className="text-right">Hafta sayısı</TableHead>
                <TableHead>Yazılı onay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const pct = Math.round(s.capRatio * 100)
                return (
                  <TableRow key={s.employee_id}>
                    <TableCell>
                      <span className="flex items-center gap-2.5 font-semibold">
                        <PersonAvatar name={s.full_name} size={28} />
                        {s.full_name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{hours(s.totalOvertimeMins)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Progress
                          value={Math.min(100, s.capRatio * 100)}
                          aria-label={`Yıllık sınırın %${pct}'i`}
                          className="min-w-[100px] flex-1"
                          indicatorClassName={s.overCap ? 'bg-danger' : s.capRatio > 0.8 ? 'bg-warning-fill' : undefined}
                        />
                        <span className={cn('shrink-0 text-xs tabular-nums', s.overCap ? 'font-semibold text-danger' : 'text-ink-secondary')}>
                          %{pct}{s.overCap && ' — sınır aşıldı'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.weeks.length}</TableCell>
                    <TableCell>
                      {s.consent_at
                        ? <StatusBadge tone="success" label={`Var · ${formatShortDateTr(s.consent_at.slice(0, 10))}`} />
                        : <StatusBadge tone="warning" label="Yok" />}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  )
}
