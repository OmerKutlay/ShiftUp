'use client'

import * as React from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/** Segment kontrol: bej zemin, seçili seçenek beyaz (Kişiler / Tablo, Gün / Hafta) */
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('inline-flex h-10 shrink-0 items-center gap-0.5 rounded-[10px] bg-surface-muted p-[3px]', className)}
      {...props}
    />
  )
}

function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-[0.8125rem] font-semibold text-ink-secondary transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
        'data-[state=on]:bg-card data-[state=on]:text-ink data-[state=on]:shadow-[0_1px_2px_rgb(43_33_27/0.08)]',
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
