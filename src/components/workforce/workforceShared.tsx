'use client'
/**
 * workforceShared — İş gücü sekmelerinin ortak parçaları: veri anahtarları (SWR), biçimlendirme
 * ve vardiya türü göstergeleri (renk çubuğu, vardiya çipi).
 *
 * Sayfa sekme sayaçları ile paneller aynı SWR anahtarlarını kullanır; istek bir kez atılır.
 */
import { format } from 'date-fns'
import { tr } from 'date-fns/locale'
import type { EmployeeAvailability, OpenShift, ShiftSwapRequest } from '@/types/workforce'
import type { ShiftKind } from '@/lib/workforcePlanner'
import { kindFromTimes } from '@/lib/workforcePlanner'
import { apiFetch } from '@/lib/api/http'
import { SHIFT_KIND_TONES } from '@/lib/palette'
import { cn } from '@/lib/utils'

// ─── Veri ────────────────────────────────────────────────────

export const openShiftsKey = (status: string) => `/api/open-shifts?status=${status}`
export const fetchOpenShifts = (url: string) => apiFetch<{ open_shifts: OpenShift[] }>(url)

export const SWAPS_KEY = '/api/shift-swap'
export const fetchSwaps = (url: string) => apiFetch<{ swap_requests: ShiftSwapRequest[] }>(url)

/** Yönetici tüm ekibin müsaitliğini, çalışan yalnızca kendisininkini görür (API de aynı kuralı uygular) */
export const availabilityKey = (isManager: boolean, employeeId: string) =>
  isManager ? '/api/availability?all=true' : `/api/availability?employee_id=${employeeId}`
export const fetchAvailability = (url: string) => apiFetch<{ availability: EmployeeAvailability[] }>(url)

// ─── Biçimlendirme ───────────────────────────────────────────

export const hhmm = (t: string) => t.slice(0, 5)
const dateOf = (d: string) => new Date(`${d}T12:00:00`)
/** '23 Eki Per' */
export const fmtDay = (d: string, pattern = 'd MMM EEE') => format(dateOf(d), pattern, { locale: tr })

/** Bugüne göre göreli gün: 'Bugün', 'Yarın', '3 gün sonra', 'Dün', '2 gün önce' */
export function relativeDay(d: string): string {
  const today = dateOf(format(new Date(), 'yyyy-MM-dd'))
  const diff = Math.round((dateOf(d).getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'Bugün'
  if (diff === 1) return 'Yarın'
  if (diff === -1) return 'Dün'
  return diff > 0 ? `${diff} gün sonra` : `${-diff} gün önce`
}

/** Dakika → '7s 30d' (DESIGN_GUIDE §6) */
export function fmtDuration(mins: number): string {
  if (mins <= 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}s` : `${h}s ${m}d`
}

export const SHIFT_KIND_LABELS: Record<ShiftKind, string> = {
  opening: 'Açılış',
  mid: 'Ortacı',
  closing: 'Kapanış',
  full: 'Full',
  custom: 'Özel',
}

export const toneOf = (kind: ShiftKind) => SHIFT_KIND_TONES[kind] ?? SHIFT_KIND_TONES.custom
export const kindOf = (start: string, end: string) => kindFromTimes(hhmm(start), hhmm(end))

// ─── Göstergeler ─────────────────────────────────────────────

/** Vardiya türü renk çubuğu (Açılış amber, Ortacı mavi, Kapanış mor) */
export function KindBar({ kind, className }: { kind: ShiftKind; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('w-1 shrink-0 self-stretch rounded-full', className)}
      style={{ backgroundColor: toneOf(kind).fill }}
    />
  )
}

/** Vardiya çipi: renk çubuğu + '23 Eki Per · 12:00–20:00' (takas, özet satırları) */
export function ShiftChip({ shift, className }: {
  shift: { work_date: string; start_time: string; end_time: string }
  className?: string
}) {
  const kind = kindOf(shift.start_time, shift.end_time)
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border bg-background pr-2 pl-1.5 text-xs whitespace-nowrap',
        className
      )}
      title={SHIFT_KIND_LABELS[kind]}
    >
      <KindBar kind={kind} className="my-1" />
      <span className="text-muted-foreground">{fmtDay(shift.work_date)}</span>
      <span className="font-medium tabular-nums">{hhmm(shift.start_time)}–{hhmm(shift.end_time)}</span>
    </span>
  )
}

/** Vardiya türü açıklaması (kart başlığında) */
export function KindLegend({ kinds = ['opening', 'mid', 'closing'], className }: { kinds?: ShiftKind[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground', className)}>
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: toneOf(k).fill }} />
          {SHIFT_KIND_LABELS[k]}
        </span>
      ))}
    </div>
  )
}
