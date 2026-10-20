/**
 * PageHeader — sayfa başlığı: başlık + açıklama solda, eylemler sağda (DESIGN_GUIDE §4).
 * Mobilde eylemler başlığın altına iner.
 */
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: React.ReactNode
  /** Başlığın altındaki kısa açıklama */
  description?: React.ReactNode
  /** @deprecated description kullanın */
  subtitle?: React.ReactNode
  /** Başlığın üstünde küçük satır (yalnızca Bugün/Genel bakış selamlaması) */
  overline?: React.ReactNode
  /** Sağdaki düğmeler (birincil eylem varsayılan Button, diğerleri outline) */
  actions?: React.ReactNode
  /** Başlığın yanında rozet vb. */
  titleAdornment?: React.ReactNode
  /** Açıklamanın altında küçük bilgi satırı (ör. son güncelleme) */
  meta?: React.ReactNode
  className?: string
}

export function PageHeader({
  title, description, subtitle, overline, actions, titleAdornment, meta, className,
}: PageHeaderProps) {
  const desc = description ?? subtitle
  return (
    <header data-slot="page-header" className={cn('mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between md:mb-6', className)}>
      <div className="min-w-0 space-y-1">
        {overline && <p className="text-sm text-muted-foreground">{overline}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {/* Mobilde başlık üst barda görünür; burada yalnızca ekran okuyucular için */}
          <h1 className="text-2xl font-semibold tracking-tight max-md:sr-only">{title}</h1>
          {titleAdornment}
        </div>
        {desc && <div className="text-sm text-muted-foreground">{desc}</div>}
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
