'use client'

/**
 * Skeletons — Sayfa ve bölüm yüklemeleri için ortak skeleton bileşenleri.
 *
 * Kural: Sayfa/bölüm içeriği yüklenirken spinner yerine bu bileşenler kullanılır.
 * Buton içi işlem göstergeleri (Kaydet, Onayla vb.) CircularProgress olarak kalır.
 *
 * Tüm skeleton'lar role="status" + aria-busy taşır; testlerde
 * `screen.queryByLabelText(LOADING_LABEL)` ile yakalanabilir.
 */
import { Box, Paper, Skeleton, Stack, Divider } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

export const LOADING_LABEL = 'İçerik yükleniyor'

const cardSx = {
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 2,
  bgcolor: 'background.paper',
} as const

function LoadingRegion({ children, sx }: { children: React.ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box role="status" aria-busy="true" aria-label={LOADING_LABEL} sx={sx}>
      {children}
    </Box>
  )
}

// ----------------------------------------------------------------
// Page header
// ----------------------------------------------------------------
export function PageHeaderSkeleton({ withActions = false }: { withActions?: boolean }) {
  return (
    <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
      <Box>
        <Skeleton variant="text" width={90} sx={{ fontSize: '0.75rem' }} />
        <Skeleton variant="text" width={220} sx={{ fontSize: '1.5rem' }} />
        <Skeleton variant="text" width={140} sx={{ fontSize: '0.875rem' }} />
      </Box>
      {withActions && <Skeleton variant="rounded" width={110} height={36} sx={{ borderRadius: 1 }} />}
    </Box>
  )
}

// ----------------------------------------------------------------
// Stat cards row (Dashboard, Günlük Operasyon, Çalışma Özetim)
// ----------------------------------------------------------------
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <LoadingRegion sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
      {Array.from({ length: count }).map((_, i) => (
        <Box
          key={i}
          sx={{
            ...cardSx,
            px: 2,
            py: 1.5,
            minWidth: { xs: 'calc(50% - 6px)', sm: 110 },
            flex: '1 1 auto',
          }}
        >
          <Skeleton variant="text" width={70} sx={{ fontSize: '0.7rem' }} />
          <Skeleton variant="text" width={36} sx={{ fontSize: '1.4rem' }} />
        </Box>
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
  /** 'card' = ayrı Paper kartlar, 'plain' = bir kapsayıcı içinde bölücülü satırlar */
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
  const avatarSize = dense ? 32 : 40
  const rows = Array.from({ length: count })

  const row = (i: number) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      {avatar && <Skeleton variant="circular" width={avatarSize} height={avatarSize} sx={{ flexShrink: 0 }} />}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Genişlikleri satırdan satıra hafifçe değiştir — daha doğal görünür */}
        <Skeleton variant="text" width={`${45 + ((i * 17) % 30)}%`} sx={{ fontSize: dense ? '0.8rem' : '0.95rem' }} />
        {lines >= 2 && <Skeleton variant="text" width={`${25 + ((i * 11) % 20)}%`} sx={{ fontSize: '0.75rem' }} />}
        {lines >= 3 && <Skeleton variant="text" width="60%" sx={{ fontSize: '0.75rem' }} />}
      </Box>
      {Array.from({ length: actions }).map((_, j) => (
        <Skeleton
          key={j}
          variant="rounded"
          width={j === 0 ? 64 : 28}
          height={j === 0 ? 22 : 28}
          sx={{ flexShrink: 0, borderRadius: j === 0 ? 1 : '50%' }}
        />
      ))}
    </Box>
  )

  if (variant === 'plain') {
    return (
      <LoadingRegion>
        {rows.map((_, i) => (
          <Box key={i}>
            <Box sx={{ px: 2, py: dense ? 1.25 : 1.75 }}>{row(i)}</Box>
            {i < count - 1 && <Divider />}
          </Box>
        ))}
      </LoadingRegion>
    )
  }

  return (
    <LoadingRegion>
      <Stack spacing={dense ? 1 : 1.5}>
        {rows.map((_, i) => (
          <Paper key={i} elevation={0} sx={{ ...cardSx, p: dense ? 1.5 : 2 }}>
            {row(i)}
          </Paper>
        ))}
      </Stack>
    </LoadingRegion>
  )
}

// ----------------------------------------------------------------
// Weekly schedule grid (Haftalık Plan)
// ----------------------------------------------------------------
export function ScheduleGridSkeleton({ rows = 6, days = 7 }: { rows?: number; days?: number }) {
  const cols = `200px repeat(${days}, minmax(110px, 1fr))`
  return (
    <LoadingRegion>
      <Paper elevation={0} sx={{ ...cardSx, overflow: 'hidden' }}>
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 200 + days * 110 }}>
            {/* Gün başlıkları */}
            <Box sx={{ display: 'grid', gridTemplateColumns: cols, gap: 1, p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton variant="text" width={80} />
              {Array.from({ length: days }).map((_, d) => (
                <Box key={d} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <Skeleton variant="text" width={40} sx={{ fontSize: '0.7rem' }} />
                  <Skeleton variant="text" width={28} />
                </Box>
              ))}
            </Box>
            {/* Çalışan satırları */}
            {Array.from({ length: rows }).map((_, r) => (
              <Box
                key={r}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: cols,
                  gap: 1,
                  p: 1.5,
                  alignItems: 'center',
                  borderBottom: r < rows - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Skeleton variant="circular" width={32} height={32} />
                  <Box sx={{ flex: 1 }}>
                    <Skeleton variant="text" width="80%" sx={{ fontSize: '0.85rem' }} />
                    <Skeleton variant="text" width="50%" sx={{ fontSize: '0.7rem' }} />
                  </Box>
                </Box>
                {Array.from({ length: days }).map((_, d) => (
                  <Skeleton
                    key={d}
                    variant="rounded"
                    height={44}
                    sx={{ borderRadius: 1.5, opacity: (r + d) % 3 === 0 ? 0.4 : 1 }}
                  />
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Paper>
    </LoadingRegion>
  )
}

// ----------------------------------------------------------------
// Data table (Raporlar)
// ----------------------------------------------------------------
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  const cols = `repeat(${columns}, minmax(80px, 1fr))`
  return (
    <LoadingRegion>
      <Paper elevation={0} sx={{ ...cardSx, overflow: 'hidden' }}>
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Skeleton variant="text" width={180} />
        </Box>
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: columns * 90 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: cols, gap: 2, px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
              {Array.from({ length: columns }).map((_, c) => (
                <Skeleton key={c} variant="text" width="60%" sx={{ fontSize: '0.7rem' }} />
              ))}
            </Box>
            {Array.from({ length: rows }).map((_, r) => (
              <Box
                key={r}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: cols,
                  gap: 2,
                  px: 2,
                  py: 1.25,
                  borderBottom: r < rows - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                }}
              >
                {Array.from({ length: columns }).map((_, c) => (
                  <Skeleton key={c} variant="text" width={`${50 + ((r + c * 7) % 40)}%`} sx={{ fontSize: '0.8rem' }} />
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Paper>
    </LoadingRegion>
  )
}

// ----------------------------------------------------------------
// Grouped day blocks (Müsaitlik, Çalışma Özetim günlük liste)
// ----------------------------------------------------------------
export function DayBlocksSkeleton({ count = 7 }: { count?: number }) {
  return (
    <LoadingRegion>
      <Stack spacing={1}>
        {Array.from({ length: count }).map((_, i) => (
          <Paper key={i} elevation={0} sx={{ ...cardSx, p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Skeleton variant="rounded" width={44} height={44} sx={{ borderRadius: 1.5, flexShrink: 0 }} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width={`${30 + ((i * 13) % 25)}%`} sx={{ fontSize: '0.9rem' }} />
              <Skeleton variant="text" width="20%" sx={{ fontSize: '0.75rem' }} />
            </Box>
            <Skeleton variant="rounded" width={56} height={22} sx={{ borderRadius: 1 }} />
          </Paper>
        ))}
      </Stack>
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
    <Box sx={{ p: { xs: 2, md: 3 }, ...(maxWidth ? { maxWidth, mx: 'auto' } : {}) }}>
      <PageHeaderSkeleton withActions />
      <Divider sx={{ mb: 3 }} />
      {stats > 0 && <StatCardsSkeleton count={stats} />}
      <ListSkeleton count={rows} />
    </Box>
  )
}
