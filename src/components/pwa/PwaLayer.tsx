'use client'

/**
 * PwaLayer — Uygulama genelindeki PWA arayüz katmanı (tüm sayfalarda, AuthProvider içinde).
 * Güncelleme uyarısı, kurulum yönlendirmesi, çevrimdışı bandı gibi bileşenler buraya eklenir.
 */
import { useState } from 'react'
import { InstallPrompt } from './InstallPrompt'
import { ServiceWorkerUpdater } from './ServiceWorkerUpdater'
import { OfflineBanner } from './OfflineBanner'
import { OfflineSessionGuard } from './OfflineSessionGuard'

export function PwaLayer() {
  // Güncelleme uyarısı açıkken alttaki kurulum kartı gösterilmez (üst üste binmesin)
  const [updateVisible, setUpdateVisible] = useState(false)

  return (
    <>
      <ServiceWorkerUpdater onVisibleChange={setUpdateVisible} />
      {!updateVisible && <InstallPrompt />}
      {/* Çevrimdışı: oturum değişince snapshot temizliği + bağlantı bandı */}
      <OfflineSessionGuard />
      <OfflineBanner />
    </>
  )
}
