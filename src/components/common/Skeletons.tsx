'use client'

/**
 * Skeletons — Sayfa ve bölüm yüklemeleri için ortak skeleton bileşenleri.
 *
 * Kural: Sayfa/bölüm içeriği yüklenirken spinner yerine bu bileşenler kullanılır.
 * Buton içi işlem göstergeleri (Kaydet, Onayla vb.) Loader2 spinner olarak kalır.
 *
 * Tüm skeleton'lar role="status" + aria-busy taşır; testlerde
 * `screen.queryByLabelText(LOADING_LABEL)` ile yakalanabilir.
 */
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const LOADING_LABEL = 'İçerik yükleniyor'

const cardClass = 'rounded-xl border bg-card shadow-xs'

function LoadingRegion({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={LOADING_LABEL} className={className}>
      {children}
    </div>
  )
}

// ----------------------------------------------------------------
// Page header
// ----------------------------------------------------------------
export function PageHeaderSkeleton({ withActions = false }: { withActions?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-[90px]" />
        <Skeleton className="h-7 w-[220px] max-w-[60vw]" />
        <Skeleton className="h-3.5 w-[140px]" />
      </div>
      {withActions && <Skeleton className="h-10 w-[110px] rounded-md" />}
    </div>
  )
}

// ----------------------------------------------------------------
// Stat cards row (Dashboard, Günlük Operasyon, Çalışma Özetim)
// ----------------------------------------------------------------
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  // StatCards ızgarasıyla aynı: 2 sütun, geniş içerikte 4
  return (
    <LoadingRegion className="grid grid-cols-2 gap-3 md:gap-4 @5xl/main:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(cardClass, 'flex flex-col gap-3 px-4 py-4 md:px-5 md:py-5')}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-4 w-32 max-w-full" />
        </div>
      ))}
    </LoadingRegion>
  )
}

// ----------------------------------------------------------------
// Card list (Çalışanlar, Şablonlar, İzinler, Talepler, Vardiyalar…)
// ----------------------------------------------------------------
interface ListSkeletonProps {
  /** Satır sayısı */
  count?: number
  /** Solda yuvarlak avatar göster */
  avatar?: boolean
  /** Sağda gösterilecek aksiyon/chip yer tutucu sayısı */
  actions?: number
  /** Metin satır sayısı (başlık dahil) */
  lines?: 1 | 2 | 3
  /** 'card' = ayrı kartlar, 'plain' = bir kapsayıcı içinde bölücülü satırlar */
  variant?: 'card' | 'plain'
  dense?: boolean
}

export function ListSkeleton({
  count = 5,
  avatar = true,
  actions = 1,
  lines = 2,
  variant = 'card',
  dense = false,
}: ListSkeletonProps) {
  const rows = Array.from({ length: count })

  const row = (i: number) => (
    <div className="flex min-w-0 items-center gap-3">
      {avatar && <Skeleton className={cn('shrink-0 rounded-full', dense ? 'size-8' : 'size-10')} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Genişlikleri satırdan satıra hafifçe değiştir — daha doğal görünür */}
        <Skeleton className={dense ? 'h-3' : 'h-3.5'} style={{ width: `${45 + ((i * 17) % 30)}%` }} />
        {lines >= 2 && <Skeleton className="h-2.5" style={{ width: `${25 + ((i * 11) % 20)}%` }} />}
        {lines >= 3 && <Skeleton className="h-2.5 w-3/5" />}
      </div>
      {Array.from({ length: actions }).map((_, j) => (
        <Skeleton key={j} className={cn('shrink-0', j === 0 ? 'h-[22px] w-16 rounded-full' : 'size-7 rounded-full')} />
      ))}
    </div>
  )

  if (variant === 'plain') {
    return (
      <LoadingRegion>
        {rows.map((_, i) => (
          <div key={i}>
            <div className={cn('px-4', dense ? 'py-2.5' : 'py-3.5')}>{row(i)}</div>
            {i < count - 1 && <Separator />}
          </div>
        ))}
      </LoadingRegion>
    )
  }

  return (
    <LoadingRegion className={cn('flex flex-col', dense ? 'gap-2' : 'gap-3')}>
      {rows.map((_, i) => (
        <div key={i} className={cn(cardClass, dense ? 'p-3' : 'p-4')}>
          {row(i)}
        </div>
      ))}
    </LoadingRegion>
  )
}

// ----------------------------------------------------------------
// Weekly schedule grid (Haftalık Plan)
// ----------------------------------------------------------------
export function ScheduleGridSkeleton({ rows = 6, days = 7 }: { rows?: number; days?: number }) {
  const gridStyle = { gridTemplateColumns: `200px repeat(${days}, minmax(110px, 1fr))` }
  return (
    <LoadingRegion>
      <div className={cn(cardClass, 'overflow-hidden')}>
        <div className="overflow-x-auto">
          <div style={{ minWidth: 200 + days * 110 }}>
            {/* Gün başlıkları */}
            <div className="grid gap-2 border-b p-3" style={gridStyle}>
              <Skeleton className="h-3.5 w-20" />
              {Array.from({ length: days }).map((_, d) => (
                <div key={d} className="flex flex-col items-center gap-1.5">
                  <Skeleton className="h-2.5 w-10" />
                  <Skeleton className="h-3.5 w-7" />
                </div>
              ))}
            </div>
            {/* Çalışan satırları */}
            {Array.from({ length: rows }).map((_, r) => (
              <div
                key={r}
                className={cn('grid items-center gap-2 p-3', r < rows - 1 && 'border-b')}
                style={gridStyle}
              >
                <div className="flex items-center gap-2">
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                </div>
                {Array.from({ length: days }).map((_, d) => (
                  <Skeleton key={d} className={cn('h-11 rounded-xl', (r + d) % 3 === 0 && 'opacity-40')} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  )
}

// ----------------------------------------------------------------
// Data table (Raporlar)
// ----------------------------------------------------------------
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  const gridStyle = { gridTemplateColumns: `repeat(${columns}, minmax(80px, 1fr))` }
  return (
    <LoadingRegion>
      <div className={cn(cardClass, 'overflow-hidden')}>
        <div className="border-b p-4">
          <Skeleton className="h-4 w-[180px]" />
        </div>
        <div className="overflow-x-auto">
          <div style={{ minWidth: columns * 90 }}>
            <div className="grid gap-4 border-b px-4 py-2.5" style={gridStyle}>
              {Array.from({ length: columns }).map((_, c) => (
                <Skeleton key={c} className="h-2.5 w-3/5" />
              ))}
            </div>
            {Array.from({ length: rows }).map((_, r) => (
              <div key={r} className={cn('grid gap-4 px-4 py-2.5', r < rows - 1 && 'border-b')} style={gridStyle}>
                {Array.from({ length: columns }).map((_, c) => (
                  <Skeleton key={c} className="h-3" style={{ width: `${50 + ((r + c * 7) % 40)}%` }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </LoadingRegion>
  )
}

// ----------------------------------------------------------------
// Grouped day blocks (Müsaitlik, Çalışma Özetim günlük liste)
// ----------------------------------------------------------------
export function DayBlocksSkeleton({ count = 7 }: { count?: number }) {
  return (
    <LoadingRegion className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(cardClass, 'flex items-center gap-3 p-3')}>
          <Skeleton className="size-11 shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width: `${30 + ((i * 13) % 25)}%` }} />
            <Skeleton className="h-2.5 w-1/5" />
          </div>
          <Skeleton className="h-[22px] w-14 rounded-full" />
        </div>
      ))}
    </LoadingRegion>
  )
}

// ----------------------------------------------------------------
// Full page (auth beklenirken / route geçişlerinde)
// ----------------------------------------------------------------
export function PageSkeleton({
  stats = 0,
  rows = 5,
  maxWidth,
}: {
  stats?: number
  rows?: number
  maxWidth?: number
}) {
  return (
    // role="status" alt bileşenlerde (StatCards/List) — burada tekrar etmiyoruz
    <div className={cn('p-4 md:p-6', maxWidth && 'mx-auto')} style={maxWidth ? { maxWidth } : undefined}>
      <PageHeaderSkeleton withActions />
      <Separator className="mb-6" />
      {stats > 0 && <StatCardsSkeleton count={stats} />}
      <ListSkeleton count={rows} />
    </div>
  )
}
