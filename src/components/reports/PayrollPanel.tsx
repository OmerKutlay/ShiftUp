'use client'

/**
 * PayrollPanel — Raporlar › Bordro puantajı.
 * Muhasebeye verilecek aylık toplamlar: önizleme tablosu + Excel (gün kodlu), CSV (yalnızca toplamlar) ve PDF indirme.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { FileSpreadsheet, Info, TriangleAlert } from 'lucide-react'
import { apiDownload, apiFetch } from '@/lib/api/http'
import { saveBlob } from '@/lib/export/download'
import { useAuth } from '@/context/AuthContext'
import type { PayrollRow } from '@/lib/payrollTimesheet'
import { ExportMenu, PeriodStepper, TableSkeleton } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Badge } from '@/components/ui/badge'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useIsMobile } from '@/hooks/useIsMobile'
import { turkeyToday } from '@/lib/dateUtils'
import { monthLabel, shiftMonth } from './timesheetSummary'
import { exportPayrollPdf } from './reportExports'

const fmt = (n: number) => (n === 0 ? '—' : n.toLocaleString('tr-TR'))

export function PayrollPanel() {
  const storeName = useAuth().store?.active.name ?? ''
  const [month, setMonth] = useState(turkeyToday().slice(0, 7))
  const { data, error, isLoading } = useSWR(
    `/api/reports/payroll?month=${month}`,
    (url: string) => apiFetch<{ rows: PayrollRow[] }>(url)
  )
  const rows = useMemo(() => data?.rows ?? [], [data])
  // Telefonda 13 sütunluk tablo sığmıyor: kişi başına kart (DESIGN_GUIDE §5 "Tablolar")
  const isMobile = useIsMobile()
  const ready = !!data && rows.length > 0
  const num = 'px-3 text-right tabular-nums'

  // Excel ve CSV sunucuda üretilir (hız sınırı + denetim kaydı); a[href] yerine blob: hata JSON'u toast olur
  const download = async (format: 'xlsx' | 'csv') => {
    const { blob, filename } = await apiDownload(`/api/reports/payroll?month=${month}&format=${format}`)
    saveBlob(blob, filename ?? `bordro-puantaj-${month}.${format}`)
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <PeriodStepper
          label={monthLabel(month)}
          onPrev={() => setMonth((m) => shiftMonth(m, -1))}
          onNext={() => setMonth((m) => shiftMonth(m, 1))}
          prevLabel="Önceki ay"
          nextLabel="Sonraki ay"
          minLabelWidth={112}
        />
        <ExportMenu
          disabled={!ready}
          className="md:ml-auto"
          options={[
            { format: 'xlsx', label: 'Excel indir (gün kodlarıyla)', run: () => download('xlsx') },
            { format: 'csv', label: 'CSV indir (toplamlar)', run: () => download('csv') },
            { format: 'pdf', run: () => exportPayrollPdf(month, rows, storeName) },
          ]}
        />
      </div>

      <Alert tone="info">
        <Info />
        <AlertTitle>Muhasebe için aylık özet</AlertTitle>
        <AlertDescription>
          SGK prim günü, eksik gün nedeni, normal ve fazla mesai saati. Sicil ve TC kimlik no sütunları boş gelir
          (saklanmaz); muhasebe doldurur. Ay bitmeden alınan çıktı geçicidir.
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Bordro puantajı yüklenemedi</AlertTitle>
          <AlertDescription>{error instanceof Error ? error.message : 'Bilinmeyen hata'}</AlertDescription>
        </Alert>
      )}

      {isLoading && !data ? (
        <TableSkeleton rows={8} columns={6} />
      ) : data && rows.length === 0 ? (
        <Empty className="border py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileSpreadsheet /></EmptyMedia>
            <EmptyTitle>Puantaj kaydı yok</EmptyTitle>
            <EmptyDescription>{monthLabel(month)} için bordroya aktarılacak kayıt bulunmuyor.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : data && isMobile ? (
        <ItemGroup className="gap-2">
          {rows.map((r) => <PayrollItem key={r.employeeId} r={r} />)}
        </ItemGroup>
      ) : data && (
        <div className="max-h-[70dvh] overflow-auto rounded-lg border">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <TableHeader className="sticky top-0 z-20 bg-muted [&_tr]:border-0">
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky left-0 z-30 h-12 min-w-44 border-b bg-muted px-4">Çalışan</TableHead>
                <TableHead className={`${num} border-b`}>Çalışılan gün</TableHead>
                <TableHead className={`${num} border-b`}>Normal s</TableHead>
                <TableHead className={`${num} border-b`}>Fazla s</TableHead>
                <TableHead className={`${num} border-b`}>Genel tatil gün</TableHead>
                <TableHead className={`${num} border-b`}>Hafta tatili</TableHead>
                <TableHead className={`${num} border-b`}>Yıllık izin</TableHead>
                <TableHead className={`${num} border-b`}>Rapor</TableHead>
                <TableHead className={`${num} border-b`}>Ücretsiz</TableHead>
                <TableHead className={`${num} border-b`}>Devamsız</TableHead>
                <TableHead className={`${num} border-b`}>Eksik gün</TableHead>
                <TableHead className={`${num} border-b`}>Neden kodu</TableHead>
                <TableHead className={`${num} border-b`}>SGK gün</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employeeId} className="group border-0 hover:bg-transparent">
                  <TableCell className="sticky left-0 z-10 h-10 border-b bg-background px-4 font-medium group-hover:bg-muted">
                    <span className="block max-w-56 truncate">{r.fullName}</span>
                    {r.noRecords && <span className="block text-xs font-normal text-warning">Kontrol edin: ay içinde kayıt yok</span>}
                  </TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.workedDays)}</TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.normalHours)}</TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.overtimeHours)}</TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.holidayWorkedDays)}</TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.weeklyRestDays)}</TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.annualLeaveDays)}</TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.sickDays)}</TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.unpaidDays)}</TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.absentDays)}</TableCell>
                  <TableCell className={`${num} border-b`}>{fmt(r.missingDays)}</TableCell>
                  <TableCell className={`${num} border-b`}>{r.missingReasonCode || '—'}</TableCell>
                  <TableCell className={`${num} border-b font-medium`}>{r.sgkDays}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Mobil kart: çalışılan gün ve saatler; sağda SGK günü, altta sıfır olmayan eksik gün kalemleri */
function PayrollItem({ r }: { r: PayrollRow }) {
  const absences = [
    { label: 'Yıllık izin', value: r.annualLeaveDays },
    { label: 'Rapor', value: r.sickDays },
    { label: 'Ücretsiz', value: r.unpaidDays },
    { label: 'Devamsız', value: r.absentDays },
    { label: 'Genel tatilde çalıştı', value: r.holidayWorkedDays },
  ].filter((a) => a.value > 0)
  return (
    <Item variant="outline" size="sm" className="bg-card">
      <ItemContent className="min-w-0">
        <ItemTitle className="truncate">{r.fullName}</ItemTitle>
        <ItemDescription className="tabular-nums">
          {r.workedDays} gün · {fmt(r.normalHours)} s normal
          {r.overtimeHours > 0 && <> · <span className="text-foreground">{fmt(r.overtimeHours)} s fazla</span></>}
        </ItemDescription>
        {r.noRecords && <ItemDescription className="text-warning">Kontrol edin: ay içinde kayıt yok</ItemDescription>}
      </ItemContent>
      <ItemActions className="flex-col items-end gap-0">
        <span className="text-lg font-semibold tabular-nums">{r.sgkDays}</span>
        <span className="text-xs text-muted-foreground">SGK gün</span>
      </ItemActions>
      {(absences.length > 0 || r.missingDays > 0) && (
        <ItemFooter className="flex-wrap justify-start gap-1.5">
          {absences.map((a) => (
            <Badge key={a.label} variant="secondary" className="tabular-nums">{a.label} {a.value}</Badge>
          ))}
          {r.missingDays > 0 && (
            <Badge tone="warning" className="tabular-nums">
              Eksik {r.missingDays} gün{r.missingReasonCode && ` · kod ${r.missingReasonCode}`}
            </Badge>
          )}
        </ItemFooter>
      )}
    </Item>
  )
}
