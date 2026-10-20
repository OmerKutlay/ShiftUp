'use client'

/**
 * Mesai düzeltme ekranlarının ortak küçük parçaları: saat aralığı rozeti, durum rozeti,
 * İş Kanunu ihlal listesi, tarih biçimleri.
 */
import { Clock3, TriangleAlert } from 'lucide-react'
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { TimeCorrectionStatus } from '@/types/timeCorrection'
import { TIME_CORRECTION_STATUS_LABELS, TIME_CORRECTION_STATUS_TONES } from '@/types/timeCorrection'
import { StatusBadge } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function fmtTime(t: string) { return t.slice(0, 5) }

/** "2026-10-17" → "17 Ekim 2026, Cumartesi" (pattern verilebilir) */
export function fmtDay(d: string, pattern = 'd MMMM yyyy, EEEE') {
  try { return format(new Date(`${d}T12:00:00`), pattern, { locale: tr }) } catch { return d }
}

/** ISO zaman → "18 Eki 08:00" */
export function fmtDateTime(iso: string) {
  try { return format(new Date(iso), 'd MMM HH:mm', { locale: tr }) } catch { return iso }
}

/** Talep edilen giriş–çıkış saatleri: outline rozet, saat ikonu, tabular rakamlar */
export function TimeRange({ start, end, className }: { start: string; end: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1 tabular-nums', className)}>
      <Clock3 className="text-muted-foreground" />
      {fmtTime(start)}–{fmtTime(end)}
    </Badge>
  )
}

/** "Yönetici Girişi" → "Yönetici girişi" (cümle düzeni) */
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLocaleLowerCase('tr-TR')

export function CorrectionStatusBadge({ status }: { status: TimeCorrectionStatus }) {
  return (
    <StatusBadge
      tone={TIME_CORRECTION_STATUS_TONES[status] ?? 'neutral'}
      label={sentence(TIME_CORRECTION_STATUS_LABELS[status] ?? status)}
    />
  )
}

/** 422 WORKING_TIME_VIOLATION yanıtındaki İş Kanunu ihlalleri */
export function ViolationList({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <Alert tone="warning">
      <TriangleAlert />
      <AlertTitle>Çalışma süresi ihlalleri (İş Kanunu)</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-0.5 pl-4">
          {items.map((v) => <li key={v}>{v}</li>)}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
