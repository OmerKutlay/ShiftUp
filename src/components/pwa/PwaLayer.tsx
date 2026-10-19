'use client'

/**
 * PwaLayer — Uygulama genelindeki PWA arayüz katmanı (tüm sayfalarda, AuthProvider içinde).
 * Güncelleme uyarısı, kurulum yönlendirmesi, çevrimdışı bandı gibi bileşenler buraya eklenir.
 */
import { useEffect, useState } from 'react'
import { onBeforeSignOut } from '@/lib/pwa/sessionEvents'
import { clearCachedPages } from '@/lib/pwa/pageCache'
import { InstallPrompt } from './InstallPrompt'
import { PushPrompt } from './PushPrompt'
import { ServiceWorkerUpdater } from './ServiceWorkerUpdater'
import { OfflineBanner } from './OfflineBanner'
import { OfflineSessionGuard } from './OfflineSessionGuard'

export function PwaLayer() {
  // Güncelleme uyarısı açıkken alttaki kurulum / bildirim kartları gösterilmez (üst üste binmesin)
  const [updateVisible, setUpdateVisible] = useState(false)

  // Çıkışta önbellekteki sayfa kabuklarını sil (ortak cihazda sonraki kullanıcı görmesin)
  useEffect(() => onBeforeSignOut(clearCachedPages), [])

  return (
    <>
      <ServiceWorkerUpdater onVisibleChange={setUpdateVisible} />
      {!updateVisible && <InstallPrompt />}
      {/* Bildirim izni önerisi: kurulu PWA / masaüstü (InstallPrompt ise mobil sekmede) */}
      {!updateVisible && <PushPrompt />}
      {/* Çevrimdışı: oturum değişince snapshot temizliği + bağlantı bandı */}
      <OfflineSessionGuard />
      <OfflineBanner />
    </>
  )
}
