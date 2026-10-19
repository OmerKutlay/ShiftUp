'use client'

/**
 * SegmentedControl — bej zemin üstünde beyaz seçili seçenekli hap grup (Kişiler / Tablo, Hafta / Gün).
 */
import { cn } from '@/lib/utils'

interface Option<T extends string> {
  value: T
  label: React.ReactNode
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: Option<T>[]
  'aria-label': string
  /** Seçili seçenek koyu (mürekkep) zeminli — mobil sekme görünümü */
  dark?: boolean
  fullWidth?: boolean
}

export function SegmentedControl<T extends string>({ value, onChange, options, dark, fullWidth, ...rest }: Props<T>) {
  return (
    <div
      role="group"
      aria-label={rest['aria-label']}
      className={cn('h-10 shrink-0 gap-0.5 rounded-[10px] bg-surface-muted p-[3px]', fullWidth ? 'flex' : 'inline-flex')}
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              'whitespace-nowrap rounded-lg px-3.5 text-[0.8125rem] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              fullWidth && 'flex-1',
              selected
                ? dark ? 'bg-ink text-white' : 'bg-card text-ink shadow-[0_1px_2px_rgb(43_33_27/0.08)]'
                : 'text-ink-secondary hover:text-ink'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
