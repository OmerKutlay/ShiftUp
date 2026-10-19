'use client'

/**
 * Cards — yeni UI'ın ortak kart parçaları (shadcn/Tailwind):
 *   StatCard     KPI kartı (etiket, büyük değer, alt not)
 *   StatGrid     KPI kartlarını eşit sütunlara dizer
 *   SectionCard  başlıklı (sayaç + bağlantı) liste kartı; satırlar ince çizgiyle ayrılır
 *   SectionRow   SectionCard satırı
 *   StatusBadge  yumuşak zeminli durum rozeti
 */
import Link from 'next/link'
import { Badge, type BadgeTone as UiBadgeTone } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// ─── Rozet ────────────────────────────────────────────────────

export type BadgeTone = Exclude<UiBadgeTone, 'outline' | 'solid'>

export function StatusBadge({ tone, label, icon, className }: {
  tone: BadgeTone; label: React.ReactNode; icon?: React.ReactNode; className?: string
}) {
  return (
    <Badge tone={tone} className={className}>
      {icon}
      {label}
    </Badge>
  )
}

// ─── KPI ──────────────────────────────────────────────────────

export function StatCard({ label, value, note, valueColor, icon, onClick, href }: {
  label: React.ReactNode
  value: React.ReactNode
  note?: React.ReactNode
  /** Değer rengi (CSS rengi; ör. C.success) */
  valueColor?: string
  icon?: React.ReactNode
  onClick?: () => void
  href?: string
}) {
  const content = (
    <>
      <span className="flex items-center gap-1.5 text-ink-secondary [&_svg]:size-4">
        {icon}
        <span className="truncate text-[0.78rem]">{label}</span>
      </span>
      <span className="my-0.5 block truncate text-[1.35rem] font-bold leading-snug md:text-[1.6rem]" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
      {note && <span className="block truncate text-xs text-ink-secondary">{note}</span>}
    </>
  )
  const cls = cn(
    'block w-full min-w-0 rounded-[14px] border bg-card p-3 text-left md:p-4',
    (onClick || href) && 'transition-colors outline-none hover:border-sand focus-visible:ring-[3px] focus-visible:ring-ring/50'
  )
  if (href) return <Link href={href} className={cls}>{content}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{content}</button>
  return <div className={cls}>{content}</div>
}

export function StatGrid({ children, min = 150, className }: { children: React.ReactNode; min?: number; className?: string }) {
  return (
    <div
      className={cn('mb-4 grid grid-cols-2 gap-2.5 sm:[grid-template-columns:repeat(auto-fit,minmax(var(--stat-min),1fr))] md:mb-6 md:gap-4', className)}
      style={{ '--stat-min': `${min}px` } as React.CSSProperties}
    >
      {children}
    </div>
  )
}

// ─── Bölüm kartı ──────────────────────────────────────────────

export function SectionCard({ title, count, subtitle, action, children, className }: {
  title: React.ReactNode
  count?: number
  subtitle?: React.ReactNode
  /** Sağ üstteki bağlantı: { label: 'Tümü →', href } ya da özel düğüm */
  action?: { label: string; href: string } | React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const actionNode = action && typeof action === 'object' && 'href' in action ? (
    <Link href={action.href} className="shrink-0 text-[0.8rem] font-semibold text-primary hover:underline">
      {action.label}
    </Link>
  ) : action
  return (
    <section className={cn('overflow-hidden rounded-2xl border bg-card', className)}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        <h2 className="text-[0.95rem] font-bold">{title}</h2>
        {count !== undefined && <span className="text-[0.78rem] text-ink-secondary">{count}</span>}
        {subtitle && <span className="min-w-0 truncate text-xs text-ink-secondary">{subtitle}</span>}
        <span className="flex-1" />
        {actionNode}
      </div>
      <div className="[&>*]:border-t">{children}</div>
    </section>
  )
}

/** SectionCard içindeki standart satır: sol (avatar + metin), sağ (rozet / değer) */
export function SectionRow({ children, onClick, href, className }: {
  children: React.ReactNode; onClick?: () => void; href?: string; className?: string
}) {
  const cls = cn(
    'flex min-h-14 w-full items-center gap-2.5 px-4 py-2.5 text-left',
    (onClick || href) && 'transition-colors outline-none hover:bg-muted/70 focus-visible:bg-muted',
    className
  )
  if (href) return <Link href={href} className={cls}>{children}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{children}</button>
  return <div className={cls}>{children}</div>
}

/** Kart içinde boş durum metni */
export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-ink-secondary">{children}</p>
}
