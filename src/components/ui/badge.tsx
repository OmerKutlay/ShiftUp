import * as React from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/** Yumuşak zeminli durum rozeti — tonlar src/lib/palette.ts ile aynı */
const badgeVariants = cva(
  'inline-flex h-[22px] w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-semibold [&>svg]:pointer-events-none [&>svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted text-ink-secondary',
        brand: 'bg-brand-soft text-brand-dark',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        info: 'bg-info-soft text-info',
        plum: 'bg-plum-soft text-plum',
        peach: 'bg-peach-soft text-peach',
        outline: 'border text-foreground',
        solid: 'bg-primary text-primary-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
)

function Badge({
  className,
  tone,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'
  return <Comp data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge, badgeVariants }
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>
