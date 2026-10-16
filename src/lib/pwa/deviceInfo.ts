/**
 * deviceInfo — Cihaz / görüntüleme kipi tespiti (yalnızca istemcide anlamlı; sunucuda güvenli varsayılan döner).
 *
 * Sadece kullanıcıya doğru yönlendirmeyi göstermek içindir; hiçbir güvenlik kararı buna dayanmaz.
 */

export type DevicePlatform = 'ios' | 'android' | 'other'

export function detectPlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent || ''
  // iPadOS 13+ kendini masaüstü Safari (MacIntel) olarak tanıtır; dokunmatik noktadan ayırt edilir
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios'
  }
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

/** Ana ekrana eklenmiş (standalone / fullscreen) PWA olarak mı çalışıyor? */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
    return ['standalone', 'fullscreen', 'minimal-ui'].some(
      (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches,
    )
  } catch {
    return false
  }
}
