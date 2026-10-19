'use client'

/**
 * PageHeader — Tüm sayfalarda ortak başlık yapısı.
 *
 *   üst satır (ör. "Günaydın, Mehmet")
 *   Başlık                                   [aksiyonlar]
 *   alt başlık
 *   meta (ör. son güncelleme)
 */
interface PageHeaderProps {
  /** Başlığın üstündeki küçük, soluk satır */
  overline?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Alt başlığın altındaki küçük, soluk satır */
  meta?: React.ReactNode
  /** Sağ üstte gösterilecek buton(lar) */
  actions?: React.ReactNode
  /** Başlığın yanında gösterilecek rozet vb. */
  titleAdornment?: React.ReactNode
}

export function PageHeader({ overline, title, subtitle, meta, actions, titleAdornment }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {overline && <p className="mb-0.5 text-xs font-medium text-ink-secondary">{overline}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[1.6rem] font-bold leading-tight tracking-tight md:text-[1.85rem]">{title}</h1>
          {titleAdornment}
        </div>
        {subtitle && <div className="mt-1 text-sm text-ink-secondary">{subtitle}</div>}
        {meta && <p className="mt-0.5 text-xs text-ink-muted">{meta}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 self-start">{actions}</div>}
    </header>
  )
}
