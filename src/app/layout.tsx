import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

export const metadata: Metadata = {
  title: 'ShiftUp — Mağaza Vardiya Yönetimi',
  description: 'Günlük operasyon, vardiya planlama ve personel devam takip sistemi',
  manifest: '/manifest.json',
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
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
        {/* PWA Service Worker registration */}
        <Script id="sw-register" strategy="afterInteractive">{`
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(function(err) { console.warn('SW registration failed:', err); });
  });
}
`}</Script>
      </body>
    </html>
  )
}
