'use client'

import { useEffect, useRef, useState } from 'react'
import { CameraOff } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { PermissionHelp } from './scanPageHelpers'

interface Props {
  onScan: (data: string) => void
  onError?: (error: string) => void
  active?: boolean
}

// html5-qrcode durum değerleri: 2 = SCANNING, 3 = PAUSED
const RUNNING_STATES = [2, 3]

interface ScannerInstance {
  stop: () => Promise<void>
  getState: () => number
}

// stop() tarayıcı çalışmıyorsa senkron olarak hata fırlatır (ör. kamera izni reddedildiğinde),
// bu yüzden durum kontrolü + try/catch ile güvenli şekilde durduruyoruz
function safeStop(scanner: ScannerInstance | null) {
  if (!scanner) return
  try {
    if (RUNNING_STATES.includes(scanner.getState())) {
      scanner.stop().catch(() => null)
    }
  } catch {
    // zaten durmuş — yok say
  }
}

export function QrScanner({ onScan, onError, active = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scannerRef = useRef<ScannerInstance | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [permissionDenied, setPermissionDenied] = useState(false)

  useEffect(() => {
    if (!active) {
      safeStop(scannerRef.current)
      scannerRef.current = null
      return
    }

    let mounted = true

    // Kamera API'si yalnızca güvenli bağlamda (HTTPS / localhost) çalışır; HTTP üzerinden
    // (ör. yerel ağ IP'si) sessizce başarısız olur — kullanıcıya açıkça söyle
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      onError?.('Kamera için güvenli bağlantı (HTTPS) gerekli. Uygulamayı https:// adresinden açın.')
      return () => { mounted = false }
    }

    // html5-qrcode yalnızca browser'da çalışır, dynamic import gerekli
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      if (!mounted || !containerRef.current) return

      // Container gerçek genişliğine göre qrbox hesapla
      // Minimum 200, maksimum 260 — taşmayı önler
      const containerWidth = containerRef.current.offsetWidth || 280
      const qrboxSize = Math.min(Math.floor(containerWidth * 0.78), 260)

      const scanner = new Html5Qrcode('qr-scanner-container')
      scannerRef.current = scanner

      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: qrboxSize, height: qrboxSize } },
          (decodedText) => {
            onScan(decodedText)
          },
          () => {
            // QR bulunamadı — normal durum, loglamıyoruz
          }
        )
        .then(() => {
          // start() sürerken unmount olduysa kamerayı açık bırakma
          if (!mounted) {
            safeStop(scanner)
            return
          }
          setInitializing(false)
        })
        .catch((err: unknown) => {
          if (scannerRef.current === scanner) scannerRef.current = null
          if (!mounted) return
          setInitializing(false)
          const message = (err instanceof Error ? `${err.name} ${err.message}` : String(err)).toLowerCase()
          if (
            message.includes('permission') ||
            message.includes('denied') ||
            message.includes('notallowed')
          ) {
            setPermissionDenied(true)
          } else {
            onError?.(err instanceof Error ? err.message : String(err))
          }
        })
    }).catch((err: unknown) => {
      if (mounted) {
        setInitializing(false)
        onError?.(err instanceof Error ? err.message : 'QR tarayıcı yüklenemedi.')
      }
    })

    return () => {
      mounted = false
      safeStop(scannerRef.current)
      scannerRef.current = null
    }
  }, [active, onScan, onError])

  if (permissionDenied) {
    return (
      <Empty className="w-full gap-4 p-0 md:p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive"><CameraOff /></EmptyMedia>
          <EmptyTitle>Kamera izni gerekli</EmptyTitle>
          <EmptyDescription>QR taraması için kamera iznine ihtiyaç var.</EmptyDescription>
        </EmptyHeader>
        {/* Cihaza / kurulu uygulamaya göre adım adım yönlendirme */}
        <PermissionHelp kind="camera" />
      </Empty>
    )
  }

  return (
    // Tam genişlik, en fazla 288px — tarayıcı her zaman kapsayıcıya sığar
    <div className="relative w-full max-w-72">
      {/* html5-qrcode mount noktası — kare oran korunur; video kapsayıcıyı doldurur, önizleme resmi gizli */}
      <div
        id="qr-scanner-container"
        ref={containerRef}
        className="aspect-square w-full overflow-hidden rounded-xl bg-black [&_img]:hidden [&_video]:!h-full [&_video]:!w-full [&_video]:object-cover"
      />

      {/* Tarama çerçevesi: dört köşe işaretçisi */}
      {!initializing && (
        <div aria-hidden className="pointer-events-none absolute inset-[14%]">
          <span className="absolute top-0 left-0 size-7 rounded-tl-lg border-t-4 border-l-4 border-white" />
          <span className="absolute top-0 right-0 size-7 rounded-tr-lg border-t-4 border-r-4 border-white" />
          <span className="absolute bottom-0 left-0 size-7 rounded-bl-lg border-b-4 border-l-4 border-white" />
          <span className="absolute right-0 bottom-0 size-7 rounded-br-lg border-r-4 border-b-4 border-white" />
        </div>
      )}

      {initializing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/80 text-white">
          <Spinner className="size-6" />
          <span className="text-xs">Kamera açılıyor…</span>
        </div>
      )}
    </div>
  )
}
