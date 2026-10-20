'use client'

/**
 * SegmentedControl — görünüm seçici (Kişiler / Tablo, Hafta / Gün): shadcn TabsList görünümünde
 * düğme grubu. Sekme içeriği değiştirmeyen, yalnızca görünümü seçen yerlerde kullanılır.
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
  /** @deprecated görünüm farkı kaldırıldı */
  dark?: boolean
  fullWidth?: boolean
}

export function SegmentedControl<T extends string>({ value, onChange, options, fullWidth, ...rest }: Props<T>) {
  return (
    <div
      role="group"
      aria-label={rest['aria-label']}
      className={cn('h-9 shrink-0 items-center rounded-lg bg-muted p-[3px] text-muted-foreground', fullWidth ? 'flex' : 'inline-flex')}
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
              'inline-flex h-full items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none',
              'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4',
              fullWidth && 'flex-1',
              selected ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
