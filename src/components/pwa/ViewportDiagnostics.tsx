'use client'

/**
 * ViewportDiagnostics — ana ekran uygulamasında (PWA) ekran / güvenli alan ölçümleri.
 *
 * iOS'un standalone görünüm alanı hataları (alt barın ekranın dibinden kopması, üst kenar
 * bulanıklığı) tarayıcıda ya da simülatörde yeniden üretilemiyor; bu kart cihazdaki gerçek
 * değerleri gösterir. Yalnızca ana ekrandan açılmış uygulamada (display-mode: standalone) görünür.
 */
import { useEffect, useState } from 'react'
import { ChevronDown, Copy, Smartphone } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Readout = Array<[label: string, value: string]>

/** CSS uzunluğunu (env(), lvh, değişken…) bir ölçüm kutusuyla piksele çevirir */
function measure(css: string, prop: 'height' | 'paddingTop' = 'height'): number {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none'
  el.style[prop] = css
  document.body.appendChild(el)
  const px = prop === 'height' ? el.getBoundingClientRect().height : parseFloat(getComputedStyle(el).paddingTop)
  el.remove()
  return Math.round(px * 10) / 10
}

function read(): Readout {
  const nav = document.querySelector('nav[aria-label="Alt menü"]')
  const header = document.querySelector('header.fixed')
  const vv = window.visualViewport
  const px = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n * 10) / 10}`)
  return [
    ['screen', `${screen.width} × ${screen.height} @${devicePixelRatio}x`],
    ['innerHeight', px(innerHeight)],
    ['clientHeight', px(document.documentElement.clientHeight)],
    ['visualViewport', vv ? `${px(vv.height)} (offsetTop ${px(vv.offsetTop)})` : '—'],
    ['100lvh / dvh / svh', `${measure('100lvh')} / ${measure('100dvh')} / ${measure('100svh')}`],
    ['safe-area üst / alt', `${measure('env(safe-area-inset-top)', 'paddingTop')} / ${measure('env(safe-area-inset-bottom)', 'paddingTop')}`],
    ['--app-top / --safe-bottom', `${measure('var(--app-top)', 'paddingTop')} / ${measure('var(--safe-bottom)', 'paddingTop')}`],
    ['üst bar alt kenarı', header ? px(header.getBoundingClientRect().bottom) : '—'],
    ['alt bar üst / alt kenarı', nav ? `${px(nav.getBoundingClientRect().top)} / ${px(nav.getBoundingClientRect().bottom)}` : '—'],
    ['scrollHeight / scrollY', `${document.documentElement.scrollHeight} / ${Math.round(scrollY)}`],
    ['yönlendirme', screen.orientation?.type ?? (innerHeight >= innerWidth ? 'portrait' : 'landscape')],
    ['tarayıcı', navigator.userAgent],
  ]
}

export function ViewportDiagnostics({ className }: { className?: string }) {
  const [standalone, setStandalone] = useState(false)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Readout>([])

  useEffect(() => {
    const mq = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
    const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true
    // Yalnızca istemcide bilinir; ilk render sunucuyla aynı (gizli) kalır
    setStandalone(mq || ios) // eslint-disable-line react-hooks/set-state-in-effect
  }, [])

  useEffect(() => {
    if (!open) return
    const update = () => setRows(read())
    update()
    addEventListener('resize', update)
    addEventListener('orientationchange', update)
    return () => {
      removeEventListener('resize', update)
      removeEventListener('orientationchange', update)
    }
  }, [open])

  if (!standalone) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rows.map(([k, v]) => `${k}: ${v}`).join('\n'))
      toast.success('Ekran bilgisi kopyalandı')
    } catch {
      toast.error('Kopyalanamadı; ekran görüntüsü alabilirsiniz')
    }
  }

  return (
    <section className={cn('rounded-lg border', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-muted-foreground"
      >
        <Smartphone className="size-4" aria-hidden />
        <span className="flex-1">Ekran bilgisi (destek için)</span>
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="border-t px-3 py-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-all tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => void copy()}>
            <Copy />
            Kopyala
          </Button>
        </div>
      )}
    </section>
  )
}
