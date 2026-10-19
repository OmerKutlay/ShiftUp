import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-xl px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      tone: {
        info: 'bg-info-soft text-ink [&>svg]:text-info',
        success: 'bg-success-soft text-ink [&>svg]:text-success',
        warning: 'bg-warning-soft text-ink [&>svg]:text-warning',
        danger: 'bg-danger-soft text-ink [&>svg]:text-danger',
        neutral: 'border bg-card text-ink [&>svg]:text-ink-secondary',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
)

function Alert({ className, tone, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ tone }), className)} {...props} />
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('col-start-2 font-semibold', className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 grid justify-items-start gap-1 text-sm text-ink-secondary [overflow-wrap:anywhere]', className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
