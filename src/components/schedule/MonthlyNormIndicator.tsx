'use client'

/**
 * MonthlyNormIndicator — haftalık plan araç çubuğunda "Aylık norm" göstergesi (yönetici).
 *
 * Gösterilen ay: görünen haftanın çoğunluğunun (perşembe günü) düştüğü ay. Hafta iki aya
 * yayılsa bile tek ay gösterilir; böylece rakam tek bir norma karşılık gelir.
 * Sunucudaki planlanan saat + bu haftadaki kaydedilmemiş taslak farkı = "öngörülen" kullanım.
 * Norm yol göstericidir: aşım uyarısı kaydı engellemez (toast + kırmızı gösterge).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Gauge } from 'lucide-react'
import { toast } from 'sonner'

import { fetchStoreNorm, storeNormKey } from '@/lib/api/storeNorm'
import { netWorkMins } from '@/lib/workingTimeService'
import {
  computeNormUsage, defaultDerivation, formatHours, majorityMonthOfWeek, monthEnd, monthLabelTr, normWarningFor,
  type NormLevel,
} from '@/lib/storeNorm'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

interface ShiftLike {
  work_date: string
  start_time: string
  end_time: string
  is_on_leave?: boolean | null
}

/** Verilen ayda (YYYY-MM-01) kalan vardiyaların net saati; izinliler hariç */
export function monthNetHours(shifts: ShiftLike[], month: string): number {
  const end = monthEnd(month)
  let mins = 0
  for (const s of shifts) {
    if (s.is_on_leave || s.work_date < month || s.work_date > end) continue
    mins += netWorkMins(s.start_time, s.end_time)
  }
  return mins / 60
}

const TONE: Record<NormLevel, { text: string; bar: string }> = {
  ok: { text: 'text-foreground', bar: 'bg-primary' },
  warn: { text: 'text-warning', bar: 'bg-warning' },
  over: { text: 'text-destructive', bar: 'bg-destructive' },
}

interface Props {
  /** Görünen haftanın ilk günü (YYYY-MM-DD) */
  weekStart: string
  /** Kayıtlı vardiyalar (yalnızca görünen hafta) */
  saved: ShiftLike[]
  /** Taslaklar uygulanmış vardiyalar (yalnızca görünen hafta) */
  projected: ShiftLike[]
  className?: string
}

export function MonthlyNormIndicator({ weekStart, saved, projected, className }: Props) {
  const month = useMemo(() => majorityMonthOfWeek(weekStart), [weekStart])
  const { data: norm, mutate } = useSWR(storeNormKey(month), () => fetchStoreNorm(month), {
    revalidateOnFocus: false,
  })

  // Hafta verisi (kayıt / silme sonrası) yenilenince sunucu toplamını da tazele. Tazeleme sürerken
  // eşik kontrolü durur: kayıtlı veri yeni, sunucu toplamı eski olduğundan aynı geçiş ikinci kez
  // uyarı vermesin. Bitince taban değer sessizce yeniden alınır.
  const first = useRef(true)
  const refreshing = useRef(false)
  const prev = useRef<{ month: string; hours: number; norm: number } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    refreshing.current = true
    void mutate().finally(() => {
      refreshing.current = false
      prev.current = null
      setTick((t) => t + 1)
    })
  }, [saved, mutate])

  // Taslak farkı: bu haftanın o aya düşen kısmı için taslaklı − kayıtlı
  const deltaHours = monthNetHours(projected, month) - monthNetHours(saved, month)
  const planned = norm ? Math.max(0, norm.plannedHours + deltaHours) : 0
  const usage = norm ? computeNormUsage(Math.round(planned * 10) / 10, norm.normHours) : null

  // Düzenleme sırasında / kayıt sonrası eşik yeni aşılınca tek seferlik, engellemeyen uyarı
  useEffect(() => {
    if (!norm || !usage || refreshing.current) return
    const last = prev.current
    prev.current = { month, hours: usage.plannedHours, norm: norm.normHours }
    if (!last || last.month !== month || last.norm !== norm.normHours) return
    const w = normWarningFor(last.hours, usage.plannedHours, norm.normHours)
    if (w && w !== normWarningFor(0, last.hours, norm.normHours)) {
      const label = monthLabelTr(month, false)
      if (w === 'over') {
        toast.warning(`${label} norm saati aşılıyor`, {
          id: 'norm-warning',
          description: `Planlanan ${formatHours(usage.plannedHours)} sa, norm ${formatHours(norm.normHours)} sa. Kayıt engellenmez.`,
        })
      } else {
        toast.info(`${label} normunun %90'ına ulaşıldı`, {
          id: 'norm-warning',
          description: `Planlanan ${formatHours(usage.plannedHours)} / ${formatHours(norm.normHours)} sa.`,
        })
      }
    }
  }, [norm, usage, month, tick])

  if (!norm || !usage) return null
  const tone = TONE[usage.level]
  const monthName = monthLabelTr(month, false)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Aylık norm: ${monthName} ${formatHours(usage.plannedHours)} / ${formatHours(norm.normHours)} saat, yüzde ${usage.percent}`}
          className={cn(
            'flex h-9 min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-sm shadow-xs',
            'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            className,
          )}
        >
          <Gauge className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn('truncate tabular-nums', tone.text)}>
            {monthName}: {formatHours(usage.plannedHours)} / {formatHours(norm.normHours)} sa (%{usage.percent})
          </span>
          <Progress
            value={Math.min(100, usage.percent)}
            indicatorClassName={tone.bar}
            className="hidden h-1.5 w-16 shrink-0 sm:block"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-sm">
        <p className="font-medium">{monthLabelTr(month)} norm saati</p>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
          <dt className="text-muted-foreground">Norm</dt>
          <dd>{formatHours(norm.normHours)} sa</dd>
          <dt className="text-muted-foreground">Planlanan{deltaHours !== 0 ? ' (taslak dahil)' : ''}</dt>
          <dd>{formatHours(usage.plannedHours)} sa</dd>
          <dt className="text-muted-foreground">{usage.remainingHours < 0 ? 'Aşım' : 'Kalan'}</dt>
          <dd className={tone.text}>{formatHours(Math.abs(usage.remainingHours))} sa</dd>
          <dt className="text-muted-foreground">Fiili çalışılan</dt>
          <dd>{formatHours(norm.workedHours ?? 0)} sa</dd>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {norm.source === 'set'
            ? 'Norm, üst yönetim adına Admin tarafından belirlendi.'
            : `Norm henüz girilmedi; tahmin kullanılıyor (${defaultDerivation(norm.employeeCount, month)}, planlanan görevli kadro).`}
          {norm.note ? ` Not: ${norm.note}` : ''}
          {' '}Norm yol göstericidir, planı engellemez.
        </p>
      </PopoverContent>
    </Popover>
  )
}
