'use client'

/**
 * BreakSummary — QR tara ekranında bugünkü molalar: her mola tek satır (çıkış – dönüş, süre).
 * Süren molada dönüş yerine canlı "kaçıncı dakika" gösterilir. Hiç mola yoksa hiçbir şey çizilmez;
 * birden çok molada başlıkta toplam yer alır.
 */
import { Coffee } from 'lucide-react'
import type { BreakItem } from '@/lib/attendanceDurations'
import { clock, useNow } from '@/components/daily-attendance/attendanceTime'
import { cn } from '@/lib/utils'

const MINUTE_MS = 60_000

/** Süren molanın kaçıncı dakikası (ilk dakika = 1) — 15 sn'de bir tazelenir */
function ActiveMinute({ startAt }: { startAt: string }) {
  const now = useNow(15_000)
  const minute = Math.max(0, Math.floor((now - new Date(startAt).getTime()) / MINUTE_MS)) + 1
  return <>{minute}. dk</>
}

export function BreakSummary({ breaks }: { breaks: BreakItem[] }) {
  if (breaks.length === 0) return null
  const total = breaks.reduce((sum, b) => sum + (b.minutes ?? 0), 0)
  const multiple = breaks.length > 1

  return (
    <section aria-label="Bugünkü molalar" className="rounded-xl border bg-card px-4 py-2.5 text-sm shadow-xs">
      {multiple && (
        <p className="flex items-center justify-between pb-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Coffee className="size-3.5" aria-hidden />Molalar</span>
          {total > 0 && <span className="tabular-nums">Toplam {total} dk</span>}
        </p>
      )}
      <ul className="divide-y">
        {breaks.map((b, i) => {
          const active = !!b.start_at && !b.end_at
          return (
            <li key={b.start_at ?? `prev-${i}`} className="flex items-center gap-3 py-1.5 tabular-nums">
              <span className="w-16 shrink-0 text-muted-foreground">
                {!multiple ? (
                  <span className="inline-flex items-center gap-1.5"><Coffee className="size-3.5" aria-hidden />Mola</span>
                ) : b.start_at ? `${i + 1}. mola` : 'Önceki'}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {b.start_at ? (
                  <>
                    {clock(b.start_at)} – {active ? <span className="text-muted-foreground">sürüyor</span> : clock(b.end_at)}
                  </>
                ) : (
                  <span className="text-muted-foreground">saat yok</span>
                )}
              </span>
              <span className={cn('shrink-0 font-medium', active && 'inline-flex items-center gap-1.5 text-warning')}>
                {active && b.start_at ? (
                  <>
                    <span aria-hidden className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
                    <ActiveMinute startAt={b.start_at} />
                  </>
                ) : (
                  `${b.minutes ?? 0} dk`
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
