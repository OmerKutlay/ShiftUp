'use client'

/**
 * useOnlineStatus — Tarayıcının çevrimiçi durumu (online/offline olayları).
 *
 * Sunucuda ve hidrasyon sırasında true döner (SSR güvenli). navigator.onLine yalnızca
 * "ağ arayüzü yok" durumunu kesin bildirir; true olması internetin çalıştığını garanti etmez —
 * bu yüzden istek hataları ayrıca ele alınmalıdır.
 */
import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function getSnapshot(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

function getServerSnapshot(): boolean {
  return true
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
