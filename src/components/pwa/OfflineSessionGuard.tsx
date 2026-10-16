'use client'

/**
 * OfflineSessionGuard — Çevrimdışı anlık görüntülerin oturumla yaşam döngüsü (görsel çıktısı yok).
 *
 *   - Çıkıştan önce tüm anlık görüntüleri siler (onBeforeSignOut).
 *   - Oturum açan çalışan cihazdaki sahipten farklıysa öncekinin anlık görüntülerini siler.
 *   - Sunucu oturumun olmadığını kesin olarak söylerse (sessionCheck 'signed-out': süresi dolmuş /
 *     iptal edilmiş oturum, pasif hesap) siler. Ağ hatası / 5xx ('unreachable') silmez —
 *     aksi halde çevrimdışı görüntüleme tam ihtiyaç anında kaybolurdu.
 *   - Oturum sunucuya ulaşılamadığı için bilinmiyorsa bağlantı geri gelince yeniden sorgular.
 */
import { useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { onBeforeSignOut } from '@/lib/pwa/sessionEvents'
import { claimSnapshotOwner, clearAllSnapshots } from '@/lib/pwa/offlineSnapshot'

export function OfflineSessionGuard() {
  const { status, employee, sessionCheck, refreshEmployee } = useAuth()
  const online = useOnlineStatus()

  useEffect(() => onBeforeSignOut(() => clearAllSnapshots()), [])

  const employeeId = employee?.id ?? null
  useEffect(() => {
    if (status === 'authenticated' && employeeId) claimSnapshotOwner(employeeId)
  }, [status, employeeId])

  // Her sorguda yeni nesne → aynı sonuç tekrar gelse de çalışır
  useEffect(() => {
    if (sessionCheck?.result === 'signed-out') clearAllSnapshots()
  }, [sessionCheck])

  const unreachable = sessionCheck?.result === 'unreachable'
  useEffect(() => {
    if (online && unreachable) void refreshEmployee()
    // unreachable bilerek bağımlılık değil: yalnızca bağlantı geri geldiğinde tetiklenir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  return null
}
