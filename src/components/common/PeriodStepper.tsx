'use client'

/**
 * PeriodStepper — "‹ Ekim 2026 ›" biçiminde dönem gezgini (ay / hafta).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  label: React.ReactNode
  onPrev: () => void
  onNext: () => void
  prevLabel: string
  nextLabel: string
  /** Etiketin en az genişliği — dönem değişince kutu zıplamasın */
  minLabelWidth?: number
  /** İleri gitme kapalı (ör. gelecek ay) */
  nextDisabled?: boolean
}

const arrow =
  'flex w-10 items-center justify-center self-stretch text-ink-secondary transition-colors outline-none hover:bg-muted focus-visible:bg-accent disabled:pointer-events-none disabled:text-ink-muted/50'

export function PeriodStepper({ label, onPrev, onNext, prevLabel, nextLabel, minLabelWidth = 96, nextDisabled }: Props) {
  return (
    <div className="inline-flex h-10 shrink-0 items-center overflow-hidden rounded-[10px] border bg-card">
      <button type="button" onClick={onPrev} aria-label={prevLabel} className={arrow}>
        <ChevronLeft className="size-4" />
      </button>
      <div
        aria-live="polite"
        className="flex items-center justify-center self-stretch whitespace-nowrap border-x px-3 text-sm font-semibold"
        style={{ minWidth: minLabelWidth }}
      >
        {label}
      </div>
      <button type="button" onClick={onNext} aria-label={nextLabel} disabled={nextDisabled} className={arrow}>
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}
