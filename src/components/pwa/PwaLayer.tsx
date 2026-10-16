'use client'

/**
 * PwaLayer — Uygulama genelindeki PWA arayüz katmanı (tüm sayfalarda, AuthProvider içinde).
 * Güncelleme uyarısı, kurulum yönlendirmesi, çevrimdışı bandı gibi bileşenler buraya eklenir.
 */
// Çevrimdışı + oturum temizliği (A5)
import { OfflineBanner } from './OfflineBanner'
import { OfflineSessionGuard } from './OfflineSessionGuard'

export function PwaLayer() {
  return (
    <>
      {/* Çevrimdışı (A5) */}
      <OfflineSessionGuard />
      <OfflineBanner />
    </>
  )
}
