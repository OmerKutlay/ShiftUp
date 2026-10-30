import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Providers } from './providers'
import { THEME_COLORS, THEME_INIT_SCRIPT } from '@/lib/theme'
import './globals.css'

// latin-ext: Türkçe karakterler (ı, ş, ğ, İ) fallback fonta düşmesin
const geistSans = Geist({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: { default: 'ShiftUp — Mağaza Vardiya Yönetimi', template: '%s — ShiftUp' },
  description: 'Günlük operasyon, vardiya planlama ve personel devam takip sistemi',
  manifest: '/manifest.json',
  // Şirket içi uygulama: arama motorlarına kapalı (X-Robots-Tag başlığı da gönderilir)
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-192.svg', type: 'image/svg+xml' },
    ],
    // iOS SVG touch icon'u desteklemez
    apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  },
  appleWebApp: {
    capable: true,
    // Opak durum çubuğu; metin rengi zemine göre (black-translucent beyaz metin ve perde verir)
    statusBarStyle: 'default',
    title: 'ShiftUp',
  },
}

// viewport-fit=cover: iOS notch/safe-area desteği
// Kamera ekranı tam genişlikte kullanabilir hale gelir
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Üst bar zemini (bg-background) ile aynı: opak durum çubuğu sayfayla bütün görünsün.
  // Sistem ayarına göre; uygulamada başka tema seçilirse lib/theme.ts etiketleri günceller.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: `dark` sınıfını hidrasyondan önce tema betiği ekler
    <html lang="tr" suppressHydrationWarning>
      <head>
        {/* İlk boyamadan önce: kayıtlı tema tercihi / sistem ayarı (yanlış temada parlama olmasın) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* Safe-area boşlukları kabukta: üst bar ve alt bar kendi zeminleriyle doldurur */}
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        {/*
          iOS 26+ ana ekran uygulaması üst kenara bulanıklık (scroll edge effect) çizer; ekranın
          en üstünde tam genişlikte, 10px'ten yüksek, zeminli bir `position: fixed` öğe bulursa
          bulanıklık yerine onun düz rengini kullanır (WebKit LocalFrameView::fixedContainerEdges).
          Bu şerit o öğedir: her sayfada (iPad'in yan menülü düzeni, giriş, kiosk) ve açık
          diyalogların üstünde de bulunur. bg-clip-text: metni olmadığından hiçbir şey boyamaz.
        */}
        <div
          aria-hidden
          className="print-hide pointer-events-none fixed inset-x-0 top-0 z-[2147483647] hidden h-3 bg-background bg-clip-text standalone:block"
        />
        {/* Service Worker kaydı ve güncelleme uyarısı: PwaLayer → ServiceWorkerUpdater */}
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
