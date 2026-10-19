'use client'

/**
 * PullToRefresh — mobilde sayfanın en üstündeyken aşağı çekerek yenileme.
 *
 * Standalone (ana ekrana eklenmiş) iOS PWA'da tarayıcı yenile butonu yoktur; bu bileşen
 * tüm SWR önbelleğini yeniden doğrular ve router.refresh() ile sunucu bileşenlerini tazeler.
 *
 * Çakışma önlemleri:
 *  - Yalnızca window en üstteyken ve dokunulan öğenin kaydırılabilir ataları da en üstteyken başlar.
 *  - Hareket yatay ağırlıklıysa (ör. haftalık plan ızgarası) iptal edilir.
 *  - Dinleyiciler bu bileşenin DOM'una bağlıdır; portal ile body'ye açılan diyaloglar etkilenmez.
 *  - `data-no-pull-refresh` taşıyan alanlarda ve `disabled` iken (QR tarayıcı) çalışmaz.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSWRConfig } from 'swr'
import { Box, CircularProgress } from '@mui/material'
import { C, tint } from '@/lib/palette'

/** Yenilemeyi tetikleyen (sönümlenmiş) çekme mesafesi */
export const PULL_THRESHOLD = 70
const MAX_PULL = 120
const RESISTANCE = 0.55
/** Yön kilitlenmeden önceki ölü bölge */
const LOCK_SLOP = 8
const MIN_SPIN_MS = 600

/** Parmak hareketini sönümlenmiş çekme mesafesine çevirir */
export function dampenPull(dy: number): number {
  if (dy <= 0) return 0
  return Math.min(MAX_PULL, dy * RESISTANCE)
}

/**
 * İlk anlamlı harekette yön kararı: 'pull' (aşağı, dikey), 'cancel' (yukarı veya yatay)
 * ya da 'wait' (henüz ölü bölgede).
 */
export function decideGesture(dx: number, dy: number): 'pull' | 'cancel' | 'wait' {
  if (Math.abs(dx) < LOCK_SLOP && Math.abs(dy) < LOCK_SLOP) return 'wait'
  if (dy <= 0 || Math.abs(dx) >= Math.abs(dy)) return 'cancel'
  return 'pull'
}

/** Dokunulan öğeden kapsayıcıya kadar: kendi içinde aşağı kaydırılmış bir alan veya yasak bölge var mı? */
function canStartFrom(target: EventTarget | null, root: HTMLElement): boolean {
  let el = target instanceof Element ? target : null
  if (el?.closest('[data-no-pull-refresh], [role="dialog"]')) return false
  while (el && el !== root) {
    if (el instanceof HTMLElement && el.scrollTop > 0) return false
    el = el.parentElement
  }
  return true
}

interface Props {
  children: React.ReactNode
  disabled?: boolean
}

export function PullToRefresh({ children, disabled = false }: Props) {
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const rootRef = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)

  const refresh = useCallback(async () => {
    refreshingRef.current = true
    setRefreshing(true)
    setPull(PULL_THRESHOLD)
    const started = Date.now()
    try {
      router.refresh()
      await mutate(() => true)
    } finally {
      const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - started))
      window.setTimeout(() => {
        refreshingRef.current = false
        setRefreshing(false)
        setPull(0)
      }, wait)
    }
  }, [mutate, router])

  useEffect(() => {
    const root = rootRef.current
    if (disabled || !root) return

    let startX = 0
    let startY = 0
    let tracking = false
    let pulling = false
    let distance = 0

    const reset = () => {
      tracking = false
      pulling = false
      distance = 0
    }

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return
      if (window.scrollY > 0 || !canStartFrom(e.target, root)) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      tracking = true
      pulling = false
      distance = 0
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      if (e.touches.length !== 1) {
        reset()
        setPull(0)
        return
      }
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!pulling) {
        const decision = decideGesture(dx, dy)
        if (decision === 'wait') return
        if (decision === 'cancel') {
          reset()
          return
        }
        pulling = true
      }
      // Çekme sırasında tarayıcının kendi bounce / yenilemesini engelle
      if (e.cancelable) e.preventDefault()
      distance = dampenPull(dy)
      setPull(distance)
    }

    const onEnd = () => {
      if (!tracking) return
      const shouldRefresh = pulling && distance >= PULL_THRESHOLD
      reset()
      if (shouldRefresh) void refresh()
      else setPull(0)
    }

    root.addEventListener('touchstart', onStart, { passive: true })
    root.addEventListener('touchmove', onMove, { passive: false })
    root.addEventListener('touchend', onEnd)
    root.addEventListener('touchcancel', onEnd)
    return () => {
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchmove', onMove)
      root.removeEventListener('touchend', onEnd)
      root.removeEventListener('touchcancel', onEnd)
    }
  }, [disabled, refresh])

  const visible = pull > 0 || refreshing
  const progress = Math.min(100, (pull / PULL_THRESHOLD) * 100)

  return (
    <Box ref={rootRef} sx={{ position: 'relative', minHeight: 'inherit' }}>
      {visible && (
        <Box
          role="status"
          aria-live="polite"
          aria-label={refreshing ? 'Yenileniyor' : 'Yenilemek için bırakın'}
          sx={{
            position: 'absolute',
            top: 0,
            left: '50%',
            zIndex: 2,
            width: 40,
            height: 40,
            ml: '-20px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: C.surface,
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: `0 4px 12px ${tint(C.ink, 0.1)}`,
            transform: `translateY(${pull - 28}px)`,
            transition: pull === 0 || refreshing ? 'transform 0.2s' : 'none',
            pointerEvents: 'none',
          }}
        >
          <CircularProgress
            size={22}
            thickness={5}
            variant={refreshing ? 'indeterminate' : 'determinate'}
            value={refreshing ? undefined : progress}
            sx={{ opacity: refreshing || pull >= PULL_THRESHOLD ? 1 : 0.6 }}
          />
        </Box>
      )}
      {children}
    </Box>
  )
}
