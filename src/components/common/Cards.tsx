'use client'

/**
 * Cards — ortak kart kalıpları (shadcn Card üzerine, DESIGN_GUIDE §5):
 *   StatCards / StatCard  KPI kartları (dashboard-01 "SectionCards")
 *   StatGrid              eski ad — StatCards ile aynı ızgara
 *   SectionCard           başlıklı liste kartı; satırlar ince çizgiyle ayrılır
 *   SectionRow            SectionCard satırı
 *   EmptyRow              kart içi kısa boş durum metni
 *   StatusBadge           durum rozeti (outline + renkli nokta)
 */
import Link from 'next/link'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type { BadgeTone }

// ─── Rozet ────────────────────────────────────────────────────

export function StatusBadge({ tone, label, icon, className }: {
  tone: BadgeTone; label: React.ReactNode; icon?: React.ReactNode; className?: string
}) {
  if (icon) {
    return (
      <Badge variant="outline" className={cn('gap-1', className)}>
        {icon}
        {label}
      </Badge>
    )
  }
  return <Badge tone={tone} className={className}>{label}</Badge>
}

// ─── KPI ──────────────────────────────────────────────────────

export function StatCards({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4',
        '*:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs',
        '[&>a>[data-slot=card]]:bg-linear-to-t [&>a>[data-slot=card]]:from-primary/5 [&>a>[data-slot=card]]:to-card [&>a>[data-slot=card]]:shadow-xs',
        className
      )}
    >
      {children}
    </div>
  )
}

/** @deprecated StatCards kullanın (min parametresi yok sayılır) */
export function StatGrid({ children, className }: { children: React.ReactNode; min?: number; className?: string }) {
  return <StatCards className={cn('mb-4 md:mb-6', className)}>{children}</StatCards>
}

export function StatCard({
  label, value, note, hint, footer, badge, valueColor, valueClassName, icon, onClick, href, className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  /** Altta soluk açıklama (eski ad) */
  note?: React.ReactNode
  /** Altta soluk açıklama */
  hint?: React.ReactNode
  /** Altta vurgulu satır */
  footer?: React.ReactNode
  /** Sağ üstte küçük rozet (trend, durum) */
  badge?: React.ReactNode
  /** @deprecated valueClassName kullanın */
  valueColor?: string
  /** Değer rengi (ör. "text-destructive") */
  valueClassName?: string
  icon?: React.ReactNode
  onClick?: () => void
  href?: string
  className?: string
}) {
  const sub = hint ?? note
  const interactive = Boolean(onClick || href)
  const card = (
    <Card
      className={cn(
        '@container/card h-full gap-3 py-4 text-left md:py-5',
        interactive && 'transition-colors hover:border-primary/40',
        className
      )}
    >
      <CardHeader className="px-4 md:px-5">
        <CardDescription className="flex min-w-0 items-center gap-1.5 [&_svg]:size-4 [&_svg]:shrink-0">
          {icon}
          <span className="truncate">{label}</span>
        </CardDescription>
        <CardTitle
          className={cn('truncate text-2xl font-semibold tabular-nums @[220px]/card:text-3xl', valueClassName)}
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
        </CardTitle>
        {/* Dar kartta (telefon) rozet etiketi sıkıştırmasın: yalnızca yeterli genişlikte */}
        {badge && <CardAction className="hidden @[200px]/card:block">{badge}</CardAction>}
      </CardHeader>
      {(footer || sub) && (
        <CardFooter className="flex-col items-start gap-1 px-4 text-sm md:px-5">
          {footer && <div className="line-clamp-1 flex items-center gap-1.5 font-medium [&_svg]:size-4">{footer}</div>}
          {sub && <div className="line-clamp-2 text-muted-foreground @[260px]/card:line-clamp-1">{sub}</div>}
        </CardFooter>
      )}
    </Card>
  )
  const focus = 'block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
  if (href) return <Link href={href} className={focus}>{card}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cn(focus, 'w-full')}>{card}</button>
  return card
}

// ─── Bölüm kartı ──────────────────────────────────────────────

export function SectionCard({ title, count, subtitle, description, action, children, className }: {
  title: React.ReactNode
  count?: number
  /** @deprecated description kullanın */
  subtitle?: React.ReactNode
  description?: React.ReactNode
  /** Sağ üstteki bağlantı: { label: 'Tümü', href } ya da özel düğüm */
  action?: { label: string; href: string } | React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const desc = description ?? subtitle
  const actionNode = action && typeof action === 'object' && 'href' in action ? (
    <Link href={action.href} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
      {action.label}
    </Link>
  ) : action
  return (
    <Card className={cn('gap-0 overflow-hidden py-0 shadow-xs', className)}>
      <CardHeader className="px-4 py-4 md:px-5">
        <CardTitle className="flex items-center gap-2">
          {title}
          {count !== undefined && <Badge variant="secondary" className="tabular-nums">{count}</Badge>}
        </CardTitle>
        {desc && <CardDescription>{desc}</CardDescription>}
        {actionNode && <CardAction className="self-center">{actionNode}</CardAction>}
      </CardHeader>
      <div className="[&>*]:border-t">{children}</div>
    </Card>
  )
}

/** SectionCard içindeki standart satır: sol (avatar + metin), sağ (rozet / değer) */
export function SectionRow({ children, onClick, href, className }: {
  children: React.ReactNode; onClick?: () => void; href?: string; className?: string
}) {
  const cls = cn(
    'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-sm md:px-5',
    (onClick || href) && 'transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted',
    className
  )
  if (href) return <Link href={href} className={cls}>{children}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{children}</button>
  return <div className={cls}>{children}</div>
}

/** Kart içinde boş durum metni */
export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>
}
