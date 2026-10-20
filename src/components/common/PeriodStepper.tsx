'use client'

/**
 * PeriodStepper — "‹ Ekim 2026 ›" biçiminde dönem gezgini (ay / hafta): shadcn ButtonGroup.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'

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

export function PeriodStepper({ label, onPrev, onNext, prevLabel, nextLabel, minLabelWidth = 96, nextDisabled }: Props) {
  return (
    <ButtonGroup className="shrink-0">
      <Button variant="outline" size="icon" onClick={onPrev} aria-label={prevLabel}>
        <ChevronLeft />
      </Button>
      <div
        aria-live="polite"
        className="flex h-9 items-center justify-center border-y bg-background px-3 text-sm font-medium whitespace-nowrap shadow-xs"
        style={{ minWidth: minLabelWidth }}
      >
        {label}
      </div>
      <Button variant="outline" size="icon" onClick={onNext} aria-label={nextLabel} disabled={nextDisabled}>
        <ChevronRight />
      </Button>
    </ButtonGroup>
  )
}
