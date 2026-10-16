/**
 * pwa.test.ts — PWA saf mantığı: SW sürüm damgası, güncelleme kontrol aralığı,
 * kurulum önerisi kapatma süresi, iOS / standalone tespiti.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { normalizeSwVersion, renderServiceWorker } from '@/lib/pwa/serviceWorkerSource'
import {
  isUpdateWaiting,
  shouldCheckForUpdate,
  UPDATE_CHECK_INTERVAL_MS,
} from '@/lib/pwa/registerServiceWorker'
import {
  DISMISS_INTERVAL_MS,
  DISMISS_KEY,
  isDismissedRecently,
  isInstallPromptHiddenPath,
  isIos,
  isIosSafari,
  isStandaloneDisplay,
  markInstallDismissed,
  readInstallDismissed,
} from '@/lib/pwa/install'

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
}

describe('SW sürüm damgası', () => {
  it('sürüm şablona gömülür ve cache adlarında kullanılır', () => {
    const src = renderServiceWorker('abc123def456-lz1k2')
    expect(src).toContain('const VERSION = "abc123def456-lz1k2"')
    expect(src).toContain("const CACHE_NAME = 'shiftup-' + VERSION")
    expect(src).toContain("const STATIC_CACHE = 'shiftup-static-' + VERSION")
  })

  it('farklı build kimliği farklı SW baytı üretir (tarayıcı güncellemeyi görür)', () => {
    expect(renderServiceWorker('a')).not.toBe(renderServiceWorker('b'))
  })

  it('güvensiz karakterler ayıklanır, boş değer "dev" olur', () => {
    expect(normalizeSwVersion('ab"c</script>;x')).toBe('abcscriptx')
    expect(normalizeSwVersion(undefined)).toBe('dev')
    expect(normalizeSwVersion('')).toBe('dev')
    expect(normalizeSwVersion('x'.repeat(100))).toHaveLength(40)
  })

  it('push handler dosyası try/catch içinde yüklenir, güncelleme SKIP_WAITING bekler', () => {
    const src = renderServiceWorker('v')
    expect(src).toMatch(/try \{\s*importScripts\('\/sw-push\.js'\)\s*\} catch/)
    expect(src).toContain("event.data.type === 'SKIP_WAITING'")
    expect(src).toContain('if (!self.registration.active) return self.skipWaiting()')
  })

  it('üretilen betik sözdizimsel olarak geçerli JS', () => {
    expect(() => new Function(renderServiceWorker('abc'))).not.toThrow()
  })
})

describe('SW güncelleme kontrolü', () => {
  it('30 dk dolmadan tekrar kontrol edilmez', () => {
    const t0 = 1_000_000
    expect(shouldCheckForUpdate(t0, t0 + 60_000)).toBe(false)
    expect(shouldCheckForUpdate(t0, t0 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false)
    expect(shouldCheckForUpdate(t0, t0 + UPDATE_CHECK_INTERVAL_MS)).toBe(true)
  })

  it('saat geri alınmışsa kontrol edilir', () => {
    expect(shouldCheckForUpdate(10_000, 5_000)).toBe(true)
  })

  it('yalnızca sayfa zaten kontrol ediliyorsa "Yeni sürüm hazır" gösterilir', () => {
    const waiting = {} as ServiceWorker
    expect(isUpdateWaiting({ waiting }, true)).toBe(true)
    expect(isUpdateWaiting({ waiting }, false)).toBe(false) // ilk kurulum
    expect(isUpdateWaiting({ waiting: null }, true)).toBe(false)
  })
})

describe('kurulum önerisi — kapatma süresi', () => {
  const now = Date.UTC(2026, 9, 16)

  it('7 gün içinde kapatıldıysa gösterilmez, sonra tekrar gösterilir', () => {
    expect(isDismissedRecently(String(now - 1000), now)).toBe(true)
    expect(isDismissedRecently(String(now - DISMISS_INTERVAL_MS + 1), now)).toBe(true)
    expect(isDismissedRecently(String(now - DISMISS_INTERVAL_MS), now)).toBe(false)
  })

  it('boş, bozuk veya gelecekteki değer yok sayılır', () => {
    expect(isDismissedRecently(null, now)).toBe(false)
    expect(isDismissedRecently('', now)).toBe(false)
    expect(isDismissedRecently('abc', now)).toBe(false)
    expect(isDismissedRecently(String(now + 60_000), now)).toBe(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('localStorage üzerinden okunur / yazılır', () => {
    markInstallDismissed(now)
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe(String(now))
    expect(readInstallDismissed(now + 1000)).toBe(true)
    expect(readInstallDismissed(now + DISMISS_INTERVAL_MS)).toBe(false)
  })

  it('localStorage hata verirse çökmez', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => markInstallDismissed(now)).not.toThrow()
    expect(readInstallDismissed(now)).toBe(false)
  })

  it('/login ve /qr-kiosk sayfalarında gösterilmez', () => {
    expect(isInstallPromptHiddenPath('/login')).toBe(true)
    expect(isInstallPromptHiddenPath('/qr-kiosk')).toBe(true)
    expect(isInstallPromptHiddenPath('/qr-kiosk/x')).toBe(true)
    expect(isInstallPromptHiddenPath('/my-schedule')).toBe(false)
    expect(isInstallPromptHiddenPath('/')).toBe(false)
    expect(isInstallPromptHiddenPath('/login-help')).toBe(false)
  })
})

describe('platform tespiti', () => {
  it('iOS: iPhone ve masaüstü UA gönderen iPad', () => {
    expect(isIos({ userAgent: UA.iphoneSafari })).toBe(true)
    expect(isIos({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 })).toBe(true)
    expect(isIos({ userAgent: UA.ipadDesktop, maxTouchPoints: 0 })).toBe(false) // gerçek Mac
    expect(isIos({ userAgent: UA.android, maxTouchPoints: 5 })).toBe(false)
    expect(isIos(undefined)).toBe(false)
  })

  it('iOS Safari: Chrome iOS ve uygulama içi tarayıcılar hariç', () => {
    expect(isIosSafari({ userAgent: UA.iphoneSafari })).toBe(true)
    expect(isIosSafari({ userAgent: UA.ipadDesktop, maxTouchPoints: 5 })).toBe(true)
    expect(isIosSafari({ userAgent: UA.iphoneChrome })).toBe(false)
    expect(isIosSafari({ userAgent: UA.iphoneInstagram })).toBe(false)
    expect(isIosSafari({ userAgent: UA.android })).toBe(false)
  })

  describe('standalone', () => {
    const originalMatchMedia = window.matchMedia
    afterEach(() => {
      window.matchMedia = originalMatchMedia
      delete (navigator as { standalone?: boolean }).standalone
    })

    const mockDisplayMode = (standalone: boolean) => {
      window.matchMedia = ((query: string) => ({
        matches: standalone && query === '(display-mode: standalone)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia
    }

    it('display-mode: standalone', () => {
      mockDisplayMode(true)
      expect(isStandaloneDisplay()).toBe(true)
      mockDisplayMode(false)
      expect(isStandaloneDisplay()).toBe(false)
    })

    it('iOS navigator.standalone', () => {
      mockDisplayMode(false)
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
      expect(isStandaloneDisplay()).toBe(true)
    })
  })
})
