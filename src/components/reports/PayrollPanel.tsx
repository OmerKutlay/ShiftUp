'use client'

/**
 * PayrollPanel — Raporlar › Bordro puantajı.
 * Muhasebeye verilecek aylık toplamlar: önizleme tablosu + Excel (gün kodlu) ve CSV (yalnızca toplamlar) indirme.
 */
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Download, FileSpreadsheet, Info, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { apiDownload, apiFetch, ApiError } from '@/lib/api/http'
import type { PayrollRow } from '@/lib/payrollTimesheet'
import { PeriodStepper, TableSkeleton } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { turkeyToday } from '@/lib/dateUtils'
import { monthLabel, shiftMonth } from './timesheetSummary'

const fmt = (n: number) => (n === 0 ? '—' : n.toLocaleString('tr-TR'))

export function PayrollPanel() {
  const [month, setMonth] = useState(turkeyToday().slice(0, 7))
  const { data, error, isLoading } = useSWR(
    `/api/reports/payroll?month=${month}`,
    (url: string) => apiFetch<{ rows: PayrollRow[] }>(url)
  )
  const rows = useMemo(() => data?.rows ?? [], [data])
  const ready = !!data && rows.length > 0
  const num = 'px-3 text-right tabular-nums'

  const [downloading, setDownloading] = useState<'xlsx' | 'csv' | null>(null)

  // a[href] ile gezinmek hata durumunda ham JSON'a götürür (standalone PWA'da geri dönüş yok): blob olarak indirilir
  const download = async (format: 'xlsx' | 'csv') => {
    setDownloading(format)
    try {
      const { blob, filename } = await apiDownload(`/api/reports/payroll?month=${month}&format=${format}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename ?? `bordro-puantaj-${month}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined
      toast.error(
        status === 429 ? 'Çok fazla indirme isteği. Lütfen birkaç dakika sonra tekrar deneyin.'
          : status && status >= 500 ? 'Dosya şu an hazırlanamadı. Lütfen tekrar deneyin.'
          : err instanceof Error ? err.message : 'İndirme başarısız oldu.'
      )
    } finally {
      setDownloading(null)
    }
  }

  const button = (format: 'xlsx' | 'csv', label: string, icon: React.ReactNode) => (
    <Button variant="outline" disabled={!ready || downloading !== null} onClick={() => void download(format)}>
      {downloading === format ? <Spinner /> : icon}
      {downloading === format ? 'Hazırlanıyor…' : label}
    </Button>
  )

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
        <div className="flex flex-wrap gap-2 md:ml-auto">
          {button('xlsx', 'Excel (gün kodlarıyla)', <FileSpreadsheet />)}
          {button('csv', 'CSV (toplamlar)', <Download />)}
        </div>
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
