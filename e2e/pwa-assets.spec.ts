/**
 * PWA varlıkları: /manifest.json geçerliliği, ikon dosyaları ve /sw.js yanıtı.
 * Tarayıcı gerektirmez (request fixture); bir projede çalışması yeterlidir.
 */
import { test, expect } from '@playwright/test'

test.beforeEach(({ baseURL: _baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'Pixel 7', 'Tarayıcıdan bağımsız — tek projede çalışır')
})

/** PNG IHDR'den genişlik/yükseklik */
function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

test('/manifest.json geçerli: id, start_url, scope, display, 192/512 ve maskable ikonlar', async ({ request }) => {
  const res = await request.get('/manifest.json')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('application/manifest+json')
  const manifest = await res.json()

  expect(manifest.id).toBe('/')
  expect(manifest.start_url).toBe('/')
  expect(manifest.scope).toBe('/')
  expect(manifest.display).toBe('standalone')
  expect(manifest.name).toBeTruthy()
  expect(manifest.short_name).toBeTruthy()
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
  expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)

  type Icon = { src: string; sizes: string; type: string; purpose?: string }
  const icons = manifest.icons as Icon[]
  const purposes = (i: Icon) => (i.purpose ?? 'any').split(/\s+/)
  const png = (size: string, purpose: string) =>
    icons.find((i) => i.type === 'image/png' && i.sizes.split(/\s+/).includes(size) && purposes(i).includes(purpose))

  const required: Array<[string, string]> = [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]
  for (const [size, purpose] of required) {
    const icon = png(size, purpose)
    expect(icon, `${size} ${purpose} PNG ikon`).toBeTruthy()
    // İkon dosyası var, PNG ve bildirilen boyutta
    const img = await request.get(icon!.src)
    expect(img.status(), icon!.src).toBe(200)
    expect(img.headers()['content-type']).toContain('image/png')
    const { width, height } = pngSize(await img.body())
    expect(`${width}x${height}`).toBe(size)
  }

  // Kısayollar kapsam içinde ve erişilebilir
  for (const s of manifest.shortcuts ?? []) {
    expect(s.url.startsWith('/')).toBe(true)
  }
})

test('/sw.js: JS, sürümlü, no-store, sw-push.js içe aktarır', async ({ request }) => {
  const res = await request.get('/sw.js')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('javascript')
  expect(res.headers()['cache-control']).toContain('no-store')
  const body = await res.text()

  expect(body).toContain("importScripts('/sw-push.js')")
  const version = body.match(/const VERSION = "([^"]+)"/)?.[1]
  expect(version, 'VERSION sabiti').toBeTruthy()
  // Production build'de build kimliği gömülür (varsayılan 'dev' değil)
  expect(version).not.toBe('dev')
  expect(body).toContain(`sürüm: ${version}`)
  // Sözdizimi geçerli (yalnızca ayrıştırılır, çalıştırılmaz)
  expect(() => new Function(body)).not.toThrow()

  // importScripts hedefi de sunuluyor
  const push = await request.get('/sw-push.js')
  expect(push.status()).toBe(200)
  expect(push.headers()['content-type']).toContain('javascript')
  expect(await push.text()).toContain("addEventListener('push'")
})

test('/sw.js ve /manifest.json oturumsuz erişilebilir (middleware login\'e yönlendirmez)', async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL, maxRedirects: 0 })
  for (const path of ['/sw.js', '/sw-push.js', '/manifest.json', '/offline', '/icon-192.png']) {
    const res = await anon.get(path)
    expect(res.status(), path).toBe(200)
  }
  // Korunan sayfa ise yönlendirilir (kontrol)
  const protectedRes = await anon.get('/my-schedule')
  expect(protectedRes.status()).toBe(307)
  expect(protectedRes.headers()['location']).toContain('/login')
  await anon.dispose()
})
