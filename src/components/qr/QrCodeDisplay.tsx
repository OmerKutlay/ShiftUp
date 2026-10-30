'use client'

import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { TimerOff } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
// qrcode kütüphanesi gerçek renk ister — CSS değişkeni değil, palette hex değerleri
import { RAW } from '@/lib/palette'

interface Props {
  data: string
  /** Render çözünürlüğü (px). Canvas bu boyutta üretilir, CSS ile ölçeklenir. Varsayılan 240. */
  size?: number
  loading?: boolean
  expired?: boolean
  className?: string
}

export function QrCodeDisplay({ data, size = 240, loading = false, expired = false, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!data || loading || expired) return
    const canvas = canvasRef.current
    if (!canvas) return

    QRCode.toCanvas(canvas, data, {
      width: size,
      margin: 2,
      color: {
        dark: RAW.ink,
        light: RAW.white,
      },
      errorCorrectionLevel: 'M',
    }).then(() => {
      // qrcode canvas'a satır içi px genişlik/yükseklik yazar; dar ekranda CSS ölçeği (w-full, aspect-square) geçerli olsun
      canvas.style.removeProperty('width')
      canvas.style.removeProperty('height')
    }).catch((err: unknown) => {
      console.error('QR kod oluşturulamadı:', err)
    })
  }, [data, size, loading, expired])

  // Responsive: tam genişlik, maxWidth ile üst sınır — kart içinde her zaman sığar
  const frame = 'aspect-square w-full rounded-xl'

  if (loading) {
    return (
      <Skeleton
        role="img"
        aria-label="QR kod oluşturuluyor"
        className={cn(frame, className)}
        style={{ maxWidth: size }}
      />
    )
  }

  if (expired) {
    return (
      <div
        className={cn(frame, 'flex flex-col items-center justify-center gap-1.5 border border-dashed bg-muted/50 text-center', className)}
        style={{ maxWidth: size }}
      >
        <TimerOff className="mb-1 size-6 text-destructive" aria-hidden />
        <p className="text-sm font-medium">QR süresi doldu</p>
        <p className="text-xs text-muted-foreground">Yenileniyor…</p>
      </div>
    )
  }

  return (
    <div
      className={cn(frame, 'overflow-hidden border bg-white p-2 shadow-xs', className)}
      style={{ maxWidth: size }}
    >
      {/*
       * Canvas: width/height attribute'u piksel çözünürlüğünü belirler.
       * CSS w-full ile container'a göre ölçeklenir — mobilde taşmaz.
       */}
      <canvas ref={canvasRef} width={size} height={size} className="block aspect-square h-auto w-full max-w-full rounded-md" />
    </div>
  )
}
