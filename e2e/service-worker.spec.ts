/**
 * Service Worker (production build): kayıt, /offline yedeği, önbellekten çevrimdışı açılış ve
 * kurulabilirlik (CDP Page.getInstallabilityErrors — Lighthouse "installable" denetiminin
 * Chrome'daki kaynağı).
 */
import { test, expect } from './support/fixtures'
import type { Page } from '@playwright/test'

test.use({ serviceWorkers: 'allow' })

/** SW etkinleşip sayfayı kontrol edene kadar bekle; sürüm etiketini döndür */
async function waitForController(page: Page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    const keys = await caches.keys()
    return { scope: reg.scope, scriptURL: reg.active?.scriptURL ?? null, caches: keys }
  })
}

test('SW kaydolur, sayfayı kontrol eder ve /offline önbelleğe alınır', async ({ page, baseURL }) => {
  await page.goto('/my-schedule')
  const info = await waitForController(page)
  expect(info.scriptURL).toBe(`${baseURL}/sw.js`)
  expect(info.scope).toBe(`${baseURL}/`)

  // Önbellek adları /sw.js'e gömülü sürümü taşır (yeni deploy → yeni cache, eskiler silinir)
  const version = (await (await page.request.get('/sw.js')).text()).match(/const VERSION = "([^"]+)"/)![1]
  expect(info.caches).toContain(`shiftup-${version}`)
  const precached = await page.evaluate(async (name) => {
    const cache = await caches.open(name)
    return (await cache.keys()).map((r) => new URL(r.url).pathname)
  }, `shiftup-${version}`)
  expect(precached).toEqual(expect.arrayContaining(['/offline', '/manifest.json', '/icon-192.png']))
})

test('çevrimdışıyken önbellekte olmayan sayfaya gidince /offline yedeği gösterilir', async ({ page, context }) => {
  await page.goto('/my-schedule')
  await waitForController(page)

  await context.setOffline(true)
  // /time-correction hiç ziyaret edilmedi → önbellekte yok
  await page.goto('/time-correction')
  await expect(page.getByText('İnternet bağlantısı yok', { exact: true })).toBeVisible()
  await expect(page.getByText(/Bağlantı geri geldiğinde sayfayı yenileyin/)).toBeVisible()
  await expect(page).toHaveTitle(/Çevrimdışı/)
})

test('Çalışma Özetim çevrimdışı yeniden açılışta önbellek + anlık görüntüden gösterilir', async ({ page, context }) => {
  await page.goto('/my-schedule')
  await waitForController(page)
  // SW kontrolündeki ikinci açılış: HTML (network-first) ve JS (cache-first) önbelleğe girer
  await page.reload()
  const main = page.getByRole('main')
  await expect(main.getByText('09:00–17:00', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  const cardsOnline = await main.getByText('09:00–17:00', { exact: true }).filter({ visible: true }).count()

  await context.setOffline(true)
  await page.reload()
  // /api/auth/me'ye ulaşılamaz → cihazdaki sahibin anlık görüntüsü kullanılır
  await expect(main.getByText(/Çevrimdışı — son güncelleme:/)).toBeVisible()
  await expect(main.getByText('Ayşe Yılmaz · Kasiyer')).toBeVisible()
  await expect(main.getByText('09:00–17:00', { exact: true }).filter({ visible: true })).toHaveCount(cardsOnline)
  await expect(page.getByText('Bağlantı yok — bazı işlemler kullanılamaz')).toBeVisible()
})

test('kurulabilirlik: Chrome installability hatası yok (manifest + SW)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP yalnızca Chromium')
  await page.goto('/my-schedule')
  await waitForController(page)

  const cdp = await page.context().newCDPSession(page)
  const manifest = (await cdp.send('Page.getAppManifest')) as {
    url: string
    errors: Array<{ message: string; critical: number }>
  }
  expect(manifest.url).toMatch(/\/manifest\.json$/)
  expect(manifest.errors).toEqual([])

  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: Array<{ errorId: string; errorArguments: unknown[] }>
  }
  // Playwright bağlamları gizli (off-the-record) profildir; Chrome bunu ayrıca bildirir —
  // uygulamayla ilgili olmadığı için yok sayılır.
  const appErrors = installabilityErrors.filter((e) => e.errorId !== 'in-incognito')
  expect(appErrors).toEqual([])
})
