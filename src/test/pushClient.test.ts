/**
 * pushClient.test.ts — src/lib/pwa/push.ts (tarayıcı tarafı abonelik yardımcıları).
 * navigator.serviceWorker / PushManager / Notification jsdom'da yoktur; testte sahte nesnelerle kurulur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Perm = NotificationPermission

const originalUA = navigator.userAgent

function setUserAgent(ua: string, platform = 'Linux x86_64', maxTouchPoints = 0) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}

function setStandalone(on: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: on && q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} }),
  })
}

function makeSubscription(endpoint: string, key: Uint8Array | null) {
  return {
    endpoint,
    options: { applicationServerKey: key ? key.buffer : null },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
}

let currentSub: ReturnType<typeof makeSubscription> | null
const pushManager = {
  getSubscription: vi.fn(async () => currentSub),
  subscribe: vi.fn(async (opts: { applicationServerKey: Uint8Array }) => {
    currentSub = makeSubscription('https://fcm.googleapis.com/fcm/send/new', opts.applicationServerKey)
    return currentSub
  }),
}

function installPushApis(permission: Perm, requestResult: Perm = 'granted') {
  const NotificationMock = Object.assign(function Notification() {}, {
    permission,
    requestPermission: vi.fn(async () => {
      NotificationMock.permission = requestResult
      return requestResult
    }),
  })
  Object.defineProperty(window, 'Notification', { value: NotificationMock, configurable: true, writable: true })
  Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true, writable: true })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn(async () => ({ pushManager })) },
  })
  return NotificationMock
}

function uninstallPushApis() {
  delete (window as unknown as Record<string, unknown>).Notification
  delete (window as unknown as Record<string, unknown>).PushManager
  delete (navigator as unknown as Record<string, unknown>).serviceWorker
}

const PUBLIC_KEY = 'BAECAwQFBgcICQ' // base64url, padding'siz
const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetModules()
  currentSub = null
  pushManager.getSubscription.mockClear()
  pushManager.subscribe.mockClear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/push/config') {
      return new Response(JSON.stringify({ enabled: true, publicKey: PUBLIC_KEY }), { status: 200 })
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  setUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/130')
  setStandalone(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  uninstallPushApis()
  setUserAgent(originalUA)
})

describe('base64url yardımcıları', () => {
  it('urlBase64ToUint8Array ↔ bufferToUrlBase64 gidiş-dönüş', async () => {
    const { urlBase64ToUint8Array, bufferToUrlBase64 } = await import('@/lib/pwa/push')
    const bytes = urlBase64ToUint8Array(PUBLIC_KEY)
    expect(Array.from(bytes)).toEqual([4, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(bufferToUrlBase64(bytes.buffer)).toBe(PUBLIC_KEY)
    expect(bufferToUrlBase64(null)).toBeNull()
  })
})

describe('getPushAvailability', () => {
  it('API yoksa unsupported', async () => {
    const { getPushAvailability, isPushSupported } = await import('@/lib/pwa/push')
    expect(isPushSupported()).toBe(false)
    expect(getPushAvailability()).toBe('unsupported')
  })

  it('API varsa supported', async () => {
    installPushApis('default')
    const { getPushAvailability } = await import('@/lib/pwa/push')
    expect(getPushAvailability()).toBe('supported')
  })

  it('iOS Safari sekmesinde ana ekrana ekleme gerekir', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1', 'iPhone', 5)
    const { getPushAvailability } = await import('@/lib/pwa/push')
    expect(getPushAvailability()).toBe('ios-needs-install')
  })

  it('iOS ana ekrandan açıldıysa supported', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1', 'iPhone', 5)
    setStandalone(true)
    installPushApis('default')
    const { getPushAvailability } = await import('@/lib/pwa/push')
    expect(getPushAvailability()).toBe('supported')
  })

  it('iOS 15 desteklenmez', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) Safari/604.1', 'iPhone', 5)
    const { getPushAvailability } = await import('@/lib/pwa/push')
    expect(getPushAvailability()).toBe('ios-too-old')
  })

  it('iPadOS (masaüstü UA + dokunmatik) iOS sayılır', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 5)
    const { isIos } = await import('@/lib/pwa/push')
    expect(isIos()).toBe(true)
  })
})

describe('subscribe', () => {
  it('izin ister, abone olur ve sunucuya kaydeder', async () => {
    const N = installPushApis('default', 'granted')
    const { subscribe } = await import('@/lib/pwa/push')
    expect(await subscribe()).toEqual({ ok: true })
    expect(N.requestPermission).toHaveBeenCalledOnce()
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/push/subscription' && init?.method === 'POST')
    expect(post).toBeTruthy()
    expect(JSON.parse(post![1].body)).toMatchObject({ endpoint: 'https://fcm.googleapis.com/fcm/send/new' })
  })

  it('izin reddedilirse denied, abonelik yapılmaz', async () => {
    installPushApis('default', 'denied')
    const { subscribe } = await import('@/lib/pwa/push')
    expect(await subscribe()).toEqual({ ok: false, reason: 'denied' })
    expect(pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('sunucuda VAPID yoksa disabled', async () => {
    installPushApis('granted')
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ enabled: false, publicKey: null })))
    const { subscribe } = await import('@/lib/pwa/push')
    expect(await subscribe()).toEqual({ ok: false, reason: 'disabled' })
  })

  it('mevcut abonelik farklı VAPID anahtarlıysa yenilenir', async () => {
    installPushApis('granted')
    const old = makeSubscription('https://fcm.googleapis.com/fcm/send/old', new Uint8Array([9, 9, 9]))
    currentSub = old
    const { subscribe } = await import('@/lib/pwa/push')
    expect(await subscribe()).toEqual({ ok: true })
    expect(old.unsubscribe).toHaveBeenCalled()
    expect(pushManager.subscribe).toHaveBeenCalledOnce()
  })

  it('desteklenmeyen tarayıcıda unsupported', async () => {
    const { subscribe } = await import('@/lib/pwa/push')
    expect(await subscribe()).toEqual({ ok: false, reason: 'unsupported' })
  })
})

describe('unsubscribe / sync / çıkış kancası', () => {
  it('unsubscribe sunucudan siler ve tarayıcı aboneliğini kaldırır', async () => {
    installPushApis('granted')
    const sub = makeSubscription('https://fcm.googleapis.com/fcm/send/x', null)
    currentSub = sub
    const { unsubscribe } = await import('@/lib/pwa/push')
    expect(await unsubscribe()).toBe(true)
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(JSON.parse(del![1].body)).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/x' })
    expect(sub.unsubscribe).toHaveBeenCalled()
  })

  it('syncSubscription izin + abonelik varsa yeniden kaydeder, yoksa hiçbir şey yapmaz', async () => {
    installPushApis('granted')
    const { syncSubscription } = await import('@/lib/pwa/push')
    expect(await syncSubscription()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    currentSub = makeSubscription('https://fcm.googleapis.com/fcm/send/x', null)
    expect(await syncSubscription()).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/push/subscription', expect.objectContaining({ method: 'POST' }))
  })

  it('çıkışta bu cihazın aboneliği kaldırılır', async () => {
    installPushApis('granted')
    const sub = makeSubscription('https://fcm.googleapis.com/fcm/send/x', null)
    currentSub = sub
    const { registerPushSignOutHook } = await import('@/lib/pwa/push')
    const { runBeforeSignOut } = await import('@/lib/pwa/sessionEvents')
    registerPushSignOutHook()
    registerPushSignOutHook() // ikinci kayıt etkisiz
    await runBeforeSignOut()
    expect(sub.unsubscribe).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
  })
})
