import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import { Providers } from './providers'

// latin-ext: Türkçe karakterler (ı, ş, ğ, İ) fallback fonta düşmesin
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap' })

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
    statusBarStyle: 'black-translucent',
    title: 'ShiftUp',
  },
}

// viewport-fit=cover: iOS notch/safe-area desteği
// Kamera ekranı tam genişlikte kullanabilir hale gelir
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#14b8a6',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      {/* paddingTop/Bottom: iOS notch + home-indicator için safe-area inset */}
      <body
        className={inter.className}
        style={{
          margin: 0,
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <AppRouterCacheProvider>
          {/* Service Worker kaydı ve güncelleme uyarısı: PwaLayer → ServiceWorkerUpdater */}
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  )
}
