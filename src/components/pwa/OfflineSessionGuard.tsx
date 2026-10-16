'use client'

/**
 * OfflineSessionGuard — Çevrimdışı anlık görüntülerin oturumla yaşam döngüsü (görsel çıktısı yok).
 *
 *   - Çıkıştan önce tüm anlık görüntüleri siler (onBeforeSignOut).
 *   - Oturum açan çalışan cihazdaki sahipten farklıysa öncekinin anlık görüntülerini siler.
 *   - Oturum çevrimiçiyken "yok" olarak çözülürse (süresi dolmuş / iptal edilmiş oturum) siler.
 *     Çevrimdışıyken /api/auth/me'ye ulaşılamadığı için gelen "unauthenticated" silmez —
 *     aksi halde çevrimdışı görüntüleme hiç çalışmazdı.
 *   - Çevrimdışı açılıp bağlantı geri gelince oturumu yeniden sorgular.
 */
import { useEffect } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { onBeforeSignOut } from '@/lib/pwa/sessionEvents'
import { claimSnapshotOwner, clearAllSnapshots } from '@/lib/pwa/offlineSnapshot'

export function OfflineSessionGuard() {
  const { status, employee, refreshEmployee } = useAuth()
  const online = useOnlineStatus()

  useEffect(() => onBeforeSignOut(() => clearAllSnapshots()), [])

  const employeeId = employee?.id ?? null
  useEffect(() => {
    if (status === 'authenticated' && employeeId) {
      claimSnapshotOwner(employeeId)
    } else if (status === 'unauthenticated' && navigator.onLine) {
      clearAllSnapshots()
    }
    // online bilerek bağımlılık değil: yalnızca oturum durumu değiştiği andaki bağlantı önemli
  }, [status, employeeId])

  useEffect(() => {
    if (online && status === 'unauthenticated') void refreshEmployee()
    // status bilerek bağımlılık değil: yalnızca bağlantı geri geldiğinde tetiklenir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  return null
}
