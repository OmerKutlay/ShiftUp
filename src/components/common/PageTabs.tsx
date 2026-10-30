'use client'

/**
 * PageTabsList — sayfanın ana sekme çubuğu (shadcn TabsList): mobilde tam genişlik, kaydırma yok;
 * sm ve üstünde içeriği kadar. Bir satıra sığmayan sekmeler `columns` ile mobilde ızgaraya dizilir
 * (ör. 6 sekme → 3 sütun × 2 satır). Dar ekranda kısa etiket için TabLabel kullanılır.
 */
import { TabsList } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const GRID_COLUMNS = {
  2: 'max-sm:grid-cols-2',
  3: 'max-sm:grid-cols-3',
  4: 'max-sm:grid-cols-4',
} as const

interface Props extends React.ComponentProps<typeof TabsList> {
  /** Mobilde ızgara sütun sayısı; verilmezse sekmeler tek satırda eşit paylaşılır */
  columns?: keyof typeof GRID_COLUMNS
}

export function PageTabsList({ columns, className, ...props }: Props) {
  return (
    <TabsList
      className={cn(
        'w-full sm:w-fit',
        columns && ['max-sm:grid max-sm:gap-[3px] max-sm:group-data-[orientation=horizontal]/tabs:h-auto', GRID_COLUMNS[columns]],
        className
      )}
      {...props}
    />
  )
}

/** Sekme etiketi: dar ekranda kısa, sm ve üstünde tam ad (gizli olan erişilebilirlik ağacına girmez) */
export function TabLabel({ short, long }: { short: string; long: string }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="max-sm:hidden">{long}</span>
    </>
  )
}
