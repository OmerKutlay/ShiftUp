'use client'

/**
 * Formda seçim alanları (DESIGN_GUIDE §5 "Formlar"):
 *   ChoiceCards  tek seçim (2–4 seçenek): shadcn RadioGroup + FieldLabel seçim kartı; seçili kart
 *                shadcn varsayılanıyla vurgulanır (border-primary, bg-primary/5)
 *   ChoiceChips  kısa etiketli çoklu seçim (ör. haftanın günleri): shadcn ToggleGroup, seçili öğe
 *                seçim kartıyla aynı vurguda
 * Görünüm değiştiren seçiciler için SegmentedControl / Tabs kullanılır.
 */
import { useId } from 'react'
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

interface Option<T extends string> {
  value: T
  label: React.ReactNode
  description?: React.ReactNode
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: Option<T>[]
  'aria-label': string
  className?: string
}

const COLS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }

export function ChoiceCards<T extends string>({ value, onChange, options, className, ...rest }: Props<T>) {
  const id = useId()
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-label={rest['aria-label']}
      className={cn('gap-2', COLS[options.length] ?? 'grid-cols-1', className)}
    >
      {options.map((o) => (
        <FieldLabel key={o.value} htmlFor={`${id}-${o.value}`} className="min-w-0 [&>*]:data-[slot=field]:p-3">
          <Field orientation="horizontal" className="gap-2.5">
            <RadioGroupItem value={o.value} id={`${id}-${o.value}`} />
            <FieldContent className="min-w-0">
              <FieldTitle className="w-full truncate">{o.label}</FieldTitle>
              {o.description && <FieldDescription>{o.description}</FieldDescription>}
            </FieldContent>
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}

export function ChoiceChips<T extends string>({ value, onChange, options, className, ...rest }: {
  value: T[]
  onChange: (value: T[]) => void
  options: { value: T; label: React.ReactNode; 'aria-label'?: string }[]
  'aria-label': string
  className?: string
}) {
  return (
    <ToggleGroup
      type="multiple"
      variant="outline"
      spacing={1.5}
      aria-label={rest['aria-label']}
      value={value}
      onValueChange={(v) => onChange(v as T[])}
      className={cn('flex-wrap', className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          aria-label={o['aria-label']}
          className="min-w-12 data-[state=on]:border-primary data-[state=on]:bg-primary/5 data-[state=on]:text-foreground dark:data-[state=on]:bg-primary/10"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
