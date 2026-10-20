import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

// latin-ext: Türkçe karakterler (ı, ş, ğ, İ) fallback fonta düşmesin
const geistSans = Geist({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-geist-mono' })

export const metadata: Metadata = {
  title: { default: 'ShiftUp — Mağaza Vardiya Yönetimi', template: '%s — ShiftUp' },
  description: 'Günlük operasyon, vardiya planlama ve personel devam takip sistemi',
  manifest: '/manifest.json',
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
    // Açık tema: koyu durum çubuğu metni (black-translucent beyaz metin verir)
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
  // Üst bar zemini (bg-background) ile aynı: opak durum çubuğu sayfayla bütün görünsün
  themeColor: '#FFFFFF',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      {/* Safe-area boşlukları kabukta: üst bar ve alt bar kendi zeminleriyle doldurur */}
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        {/* Service Worker kaydı ve güncelleme uyarısı: PwaLayer → ServiceWorkerUpdater */}
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
