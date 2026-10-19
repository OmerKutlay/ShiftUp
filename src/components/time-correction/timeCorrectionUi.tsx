'use client'

/**
 * Mesai düzeltme ekranlarının ortak küçük parçaları (saat hapı, ihlal listesi).
 */
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

export function fmtTime(t: string) { return t.slice(0, 5) }

/** Talep edilen giriş – çıkış saatleri: kalın, tabular rakamlı hap */
export function TimePill({ start, end, className }: { start: string; end: string; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-md bg-brand-soft px-2 text-xs font-bold tabular-nums text-brand-dark', className)}>
      {fmtTime(start)} – {fmtTime(end)}
    </span>
  )
}

/** 422 WORKING_TIME_VIOLATION yanıtındaki İş Kanunu ihlalleri */
export function ViolationList({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <Alert tone="warning">
      <TriangleAlert />
      <AlertTitle>Çalışma süresi ihlalleri (İş Kanunu):</AlertTitle>
      <AlertDescription className="text-ink">
        <ul className="list-disc pl-4 text-xs">
          {items.map((v) => <li key={v}>{v}</li>)}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
