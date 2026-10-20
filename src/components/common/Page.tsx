/**
 * Page — tüm sayfaların ortak iskeleti (bkz. docs/design/DESIGN_GUIDE.md §4).
 *   size="full"   veri sayfaları (varsayılan)
 *   size="narrow" okuma / form sayfaları (max-w-3xl)
 */
import { cn } from '@/lib/utils'

export function Page({ children, size = 'full', className }: {
  children: React.ReactNode
  size?: 'full' | 'narrow'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col gap-4 p-4 md:gap-6 md:p-6 *:data-[slot=page-header]:mb-0',
        size === 'narrow' && 'mx-auto max-w-3xl',
        className
      )}
    >
      {children}
    </div>
  )
}
