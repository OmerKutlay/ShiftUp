'use client'

/**
 * MonthlyNormCard — Genel bakış: bu ayın mağaza norm saati kullanımı (planlanan / norm).
 * Veri alınamazsa (yetki, ağ) kart sessizce gizlenir; panelin geri kalanını etkilemez.
 */
import Link from 'next/link'
import useSWR from 'swr'
import { Gauge } from 'lucide-react'

import { fetchStoreNorm, storeNormKey } from '@/lib/api/storeNorm'
import { turkeyToday } from '@/lib/dateUtils'
import { formatHours, monthLabelTr } from '@/lib/storeNorm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

const TONE = {
  ok: { text: '', bar: 'bg-primary' },
  warn: { text: 'text-warning', bar: 'bg-warning' },
  over: { text: 'text-destructive', bar: 'bg-destructive' },
} as const

export function MonthlyNormCard() {
  const month = `${turkeyToday().slice(0, 7)}-01`
  const { data: norm } = useSWR(storeNormKey(month), () => fetchStoreNorm(month))
  if (!norm) return null
  const tone = TONE[norm.level]

  return (
    <Link href="/schedule" className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <Card className="gap-3 py-4 shadow-xs transition-colors hover:border-primary/40 md:py-5">
        <CardHeader className="px-4 md:px-5">
          <CardDescription className="flex items-center gap-1.5 [&_svg]:size-4">
            <Gauge /> Aylık norm kullanımı · {monthLabelTr(month)}
          </CardDescription>
          <CardTitle className={cn('text-2xl font-semibold tabular-nums', tone.text)}>
            {formatHours(norm.plannedHours)} / {formatHours(norm.normHours)} sa
            <span className="ml-2 text-base font-medium">%{norm.percent}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 px-4 md:px-5">
          <Progress value={Math.min(100, norm.percent)} indicatorClassName={tone.bar} aria-label="Norm kullanımı" />
          <p className="text-sm text-muted-foreground">
            {norm.remainingHours < 0
              ? `${formatHours(-norm.remainingHours)} sa aşım`
              : `${formatHours(norm.remainingHours)} sa kaldı`}
            {norm.source === 'default' && ' · norm henüz girilmedi (tahmin)'}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}
