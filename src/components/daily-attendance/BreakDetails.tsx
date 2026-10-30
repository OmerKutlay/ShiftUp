'use client'

/**
 * BreakDetails — günün molaları. Satırda yalnızca kısa özet (toplam süre, mola sayısı / süren mola);
 * üzerine gelince (fare) ya da dokununca küçük bir pencerede her mola sırasıyla: kaçıncı mola,
 * çıkış – dönüş saati ve süresi, altta toplam. Günlük operasyon tablosu, mobil kartı ve QR tara
 * ekranı aynı listeyi kullanır.
 */
import { useEffect, useRef, useState } from 'react'
import { Coffee } from 'lucide-react'
import type { BreakItem } from '@/lib/attendanceDurations'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { clock, formatDelay } from './attendanceTime'

const MINUTE_MS = 60_000

/** Molanın süresi (dk) — süren molada şimdiye kadar geçen */
export function breakMinutes(b: BreakItem, now: number): number {
  if (b.minutes !== null) return b.minutes
  return b.start_at ? Math.max(0, Math.floor((now - new Date(b.start_at).getTime()) / MINUTE_MS)) : 0
}

/**
 * Satır etiketi. Saatleri bilinmeyen önceki molalar (eski kayıt) tek satıra indirgendiyse
 * sıra numarası bilinmez: "Önceki molalar" + "Son mola".
 */
function breakLabel(b: BreakItem, i: number, breaks: BreakItem[]): string {
  if (!b.start_at) return 'Önceki molalar'
  return breaks[0].start_at ? `${i + 1}. mola` : 'Son mola'
}

export interface BreakStats {
  /** Mola sayısı; saatsiz önceki molalar varsa bilinmez (null) */
  count: number | null
  /** Toplam mola (dk) — süren mola şimdiye kadarki süresiyle */
  total: number
  /** Süren mola: sırası (bilinmiyorsa null) ve geçen dk */
  active: { ordinal: number | null; minutes: number } | null
}

export function breakStats(breaks: BreakItem[], now: number): BreakStats {
  const numbered = breaks.length > 0 && !!breaks[0].start_at
  const last = breaks.at(-1)
  return {
    count: numbered ? breaks.length : null,
    total: breaks.reduce((sum, b) => sum + breakMinutes(b, now), 0),
    active: last?.start_at && !last.end_at
      ? { ordinal: numbered ? breaks.length : null, minutes: breakMinutes(last, now) }
      : null,
  }
}

/** "2. mola" / "Mola" — süren molanın kısa adı */
export function activeBreakLabel(active: NonNullable<BreakStats['active']>): string {
  return active.ordinal ? `${active.ordinal}. mola` : 'Mola'
}

/** Özet tetikleyicinin ekran okuyucu adı: "Molalar: 2 mola, toplam 27 dk, 2. mola sürüyor" */
export function breakStatsLabel(stats: BreakStats): string {
  return `Molalar: ${[
    stats.count !== null && `${stats.count} mola`,
    `toplam ${formatDelay(stats.total)}`,
    stats.active && `${activeBreakLabel(stats.active)} sürüyor`,
  ].filter(Boolean).join(', ')}`
}

/** Molaların sıralı listesi + toplam */
export function BreakList({ breaks, now, className }: { breaks: BreakItem[]; now: number; className?: string }) {
  const { total } = breakStats(breaks, now)
  return (
    <div className={cn('flex flex-col gap-1.5 text-sm', className)}>
      <ul className="divide-y">
        {breaks.map((b, i) => {
          const active = !!b.start_at && !b.end_at
          return (
            <li key={b.start_at ?? `prev-${i}`} className="flex items-center gap-3 py-1.5 tabular-nums">
              <span className="w-24 shrink-0 text-muted-foreground">{breakLabel(b, i, breaks)}</span>
              <span className="min-w-0 flex-1 truncate">
                {b.start_at
                  ? <>{clock(b.start_at)} – {active ? <span className="text-warning">sürüyor</span> : clock(b.end_at)}</>
                  : <span className="text-muted-foreground">saat yok</span>}
              </span>
              <span className={cn('shrink-0 font-medium', active && 'text-warning')}>{formatDelay(breakMinutes(b, now))}</span>
            </li>
          )
        })}
      </ul>
      {breaks.length > 1 && (
        <p className="flex items-center justify-between border-t pt-1.5 text-xs text-muted-foreground tabular-nums">
          <span>Toplam</span>
          <span className="font-medium text-foreground">{formatDelay(total)}</span>
        </p>
      )}
    </div>
  )
}

/**
 * Günlük operasyon satırındaki mola özeti: toplam süre + "2 mola" (ya da "2. mola sürüyor").
 * stack: tablo hücresi (iki satır), inline: mobil kart (tek satır, kahve simgesiyle).
 */
export function BreakCell({ breaks, now, variant = 'stack' }: {
  breaks: BreakItem[]
  now: number
  variant?: 'stack' | 'inline'
}) {
  if (breaks.length === 0) return variant === 'stack' ? <span className="text-muted-foreground">—</span> : null
  const stats = breakStats(breaks, now)
  const label = breakStatsLabel(stats)
  const detail = stats.active ? (
    <span className="inline-flex items-center gap-1 text-warning">
      <span aria-hidden className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
      {activeBreakLabel(stats.active)} sürüyor
    </span>
  ) : stats.count !== null && <span className="text-muted-foreground">{stats.count} mola</span>

  return (
    <BreakDetails breaks={breaks} now={now} label={label}>
      {variant === 'stack' ? (
        <span className="flex flex-col tabular-nums whitespace-nowrap">
          <span className="w-fit underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">
            {formatDelay(stats.total)}
          </span>
          <span className="text-xs">{detail}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap">
          <Coffee aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="underline decoration-muted-foreground/40 decoration-dotted underline-offset-4">{formatDelay(stats.total)}</span>
          {detail && <span className="text-xs">· {detail}</span>}
        </span>
      )}
    </BreakDetails>
  )
}

/**
 * Özet + ayrıntı penceresi. Fareyle üzerine gelince açılır, ayrılınca kapanır; dokunmatikte
 * (ve klavyede) tıklayınca açılır, dışarı dokununca / Esc ile kapanır.
 */
export function BreakDetails({ breaks, now, label, className, children }: {
  breaks: BreakItem[]
  now: number
  /** Tetikleyicinin ekran okuyucu adı (ör. "Molalar: 2 mola, toplam 27 dk") */
  label: string
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  // Fare tetikleyiciden pencereye geçerken kapanmasın diye kısa gecikme
  const hover = (next: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    clearTimeout(closeTimer.current)
    if (next) setOpen(true)
    else closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        // Üzerine gelince zaten açık; tıklama kapatmasın, yalnızca açsın
        onClick={(e) => { e.preventDefault(); setOpen(true) }}
        className={cn(
          'cursor-pointer rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className
        )}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-3"
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <p className="pb-1 text-xs font-medium text-muted-foreground">Bugünkü molalar</p>
        <BreakList breaks={breaks} now={now} />
      </PopoverContent>
    </Popover>
  )
}
