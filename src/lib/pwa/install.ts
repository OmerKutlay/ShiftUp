/**
 * install — "Ana ekrana ekle" yardımcıları (istemci tarafı).
 *
 * - Platform tespiti: isIos(), isIosSafari(), isStandaloneDisplay() / useIsStandalone()
 * - Android/Chrome: `beforeinstallprompt` olayı yakalanıp saklanır; useInstallPromptEvent()
 *   ile okunur, promptInstall() ile tarayıcının kurulum penceresi açılır.
 * - Kapatma hatırlatması: kullanıcı kapatırsa DISMISS_INTERVAL_MS (7 gün) boyunca tekrar gösterilmez.
 *
 * Diğer PWA modülleri (ör. bildirim izni — iOS'ta yalnızca ana ekrana eklenmiş uygulamada çalışır)
 * useIsStandalone() ve isIos()'u buradan kullanır.
 */
import { useSyncExternalStore } from 'react'

// ─── Platform tespiti ────────────────────────────────────────

interface NavigatorLike {
  userAgent: string
  maxTouchPoints?: number
  standalone?: boolean
}

function currentNavigator(): NavigatorLike | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as NavigatorLike)
}

/**
 * iPhone / iPad / iPod mu? iPadOS 13+ masaüstü Safari UA'sı ("Macintosh") gönderir; dokunmatik
 * noktası olan "Macintosh" iPad kabul edilir.
 */
export function isIos(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  if (!nav) return false
  const ua = nav.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1
}

/**
 * iOS'ta Safari mi? (Chrome/Firefox/Edge iOS ve uygulama içi tarayıcılar hariç — onlarda
 * Paylaş menüsü farklı yerde / yok, yönergeler yanıltıcı olur.)
 */
export function isIosSafari(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  if (!nav || !isIos(nav)) return false
  const ua = nav.userAgent
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\/|WhatsApp/.test(ua)) return false
  return /Safari\//.test(ua)
}

const STANDALONE_QUERY = '(display-mode: standalone)'

/** Uygulama ana ekrandan (kurulu PWA olarak) mı açıldı? */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  if ((currentNavigator()?.standalone ?? false) === true) return true
  return typeof window.matchMedia === 'function' && window.matchMedia(STANDALONE_QUERY).matches
}

function subscribeStandalone(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(STANDALONE_QUERY)
  mql.addEventListener?.('change', onChange)
  return () => mql.removeEventListener?.('change', onChange)
}

/** Kurulu PWA olarak mı çalışıyor? SSR'da ve ilk hydration'da false döner. */
export function useIsStandalone(): boolean {
  return useSyncExternalStore(subscribeStandalone, isStandaloneDisplay, () => false)
}

// ─── Gösterim kuralları ──────────────────────────────────────

/** Kurulum önerisinin hiç gösterilmeyeceği sayfalar (giriş ekranı, tam ekran kiosk) */
const HIDDEN_PATH_PREFIXES = ['/login', '/qr-kiosk']

export function isInstallPromptHiddenPath(pathname: string | null | undefined): boolean {
  if (!pathname) return true
  return HIDDEN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export const DISMISS_KEY = 'shiftup.installPrompt.dismissedAt'
/** Kapatıldıktan sonra tekrar gösterilmeden önce beklenecek süre (7 gün) */
export const DISMISS_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

/** Kaydedilmiş kapatma zamanı hâlâ bekleme süresi içinde mi? Bozuk / gelecekteki değer yok sayılır. */
export function isDismissedRecently(
  stored: string | null | undefined,
  now: number,
  intervalMs = DISMISS_INTERVAL_MS
): boolean {
  if (!stored) return false
  const at = Number(stored)
  if (!Number.isFinite(at) || at <= 0 || at > now) return false
  return now - at < intervalMs
}

/** localStorage'a erişilemezse (gizli mod, kapalı depolama) "kapatılmamış" sayılır */
export function readInstallDismissed(now = Date.now()): boolean {
  try {
    return isDismissedRecently(window.localStorage.getItem(DISMISS_KEY), now)
  } catch {
    return false
  }
}

export function markInstallDismissed(now = Date.now()): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(now))
  } catch {
    /* depolama yoksa yalnızca bu oturum için gizlenir (bileşen state'i) */
  }
}

// ─── beforeinstallprompt (Android / Chromium) ───────────────

/** Standart DOM tiplerinde yok (yalnızca Chromium) */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
let listening = false

function emit() {
  listeners.forEach((l) => l())
}

/**
 * Pencere dinleyicilerini bir kez bağlar. Olay erken (bileşen mount olmadan) gelebileceği için
 * modül düzeyinde saklanır.
 */
export function listenForInstallPrompt(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('beforeinstallprompt', (e) => {
    // Tarayıcının kendi mini bilgi çubuğunu engelle; kendi kartımızı gösteririz
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    emit()
  })
}

function subscribeInstallPrompt(onChange: () => void): () => void {
  listenForInstallPrompt()
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Saklanan beforeinstallprompt olayı (yoksa null) */
export function useInstallPromptEvent(): BeforeInstallPromptEvent | null {
  return useSyncExternalStore(
    subscribeInstallPrompt,
    () => deferredPrompt,
    () => null
  )
}

/** Tarayıcının kurulum penceresini açar. Olay tek kullanımlıktır; sonuç ne olursa olsun temizlenir. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt
  if (!event) return 'unavailable'
  deferredPrompt = null
  emit()
  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice.outcome
  } catch {
    return 'unavailable'
  }
}
