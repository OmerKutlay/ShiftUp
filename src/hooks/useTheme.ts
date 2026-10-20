'use client'

/**
 * useTheme — tema tercihi deposu (lib/theme.ts): tercihi okur / yazar, `<html>`'deki `.dark`
 * sınıfını ve theme-color etiketlerini günceller; sistem ayarı ve başka sekmedeki değişiklikleri izler.
 */
import { useSyncExternalStore } from 'react'

import {
  DARK_QUERY,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme'

function readPreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

const systemDark = () => window.matchMedia(DARK_QUERY).matches

function applyTheme() {
  const theme = resolveTheme(readPreference(), systemDark())
  document.documentElement.classList.toggle('dark', theme === 'dark')
  // Seçim sistem ayarından farklı olabilir: medya koşullu theme-color etiketlerinin hepsi seçilen rengi alır
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', THEME_COLORS[theme]))
}

const listeners = new Set<() => void>()

function notify() {
  applyTheme()
  listeners.forEach((l) => l())
}

function onStorage(e: StorageEvent) {
  if (e.key === THEME_STORAGE_KEY) notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    // Medya koşullu theme-color etiketleri sistem ayarına göre; seçilen tema farklıysa düzelt
    applyTheme()
    window.matchMedia(DARK_QUERY).addEventListener('change', notify)
    // Başka sekmede değişen tercih
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.matchMedia(DARK_QUERY).removeEventListener('change', notify)
      window.removeEventListener('storage', onStorage)
    }
  }
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Depolama kapalı (gizli mod vb.): tercih kaydedilemez, sistem ayarı geçerli kalır
  }
  notify()
}

const getSnapshot = () => `${readPreference()}:${systemDark() ? 'dark' : 'light'}`
const getServerSnapshot = () => 'system:light'

export function useTheme() {
  const [preference, system] = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  ).split(':') as [ThemePreference, ResolvedTheme]
  return {
    preference,
    resolvedTheme: resolveTheme(preference, system === 'dark'),
    setPreference: setThemePreference,
  }
}
