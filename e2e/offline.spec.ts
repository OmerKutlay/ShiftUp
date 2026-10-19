/**
 * Çevrimdışı arayüz (SW engelli): bağlantı bandı, QR Tara butonlarının kapanması ve
 * Çalışma Özetim'in çevrimiçi ziyaretten kalan anlık görüntüyü göstermesi.
 * SW ile çevrimdışı yeniden açılış: service-worker.spec.ts.
 */
import { test, expect } from './support/fixtures'

const BANNER_OFFLINE = 'Bağlantı yok — bazı işlemler kullanılamaz'

test('çevrimdışı bandı görünür, bağlantı gelince "geri geldi" gösterip kaybolur', async ({ page, context }) => {
  await page.goto('/my-schedule')
  await expect(page.getByRole('main').getByRole('heading', { name: 'Çalışma özetim' })).toBeVisible()
  await expect(page.getByText(BANNER_OFFLINE)).toHaveCount(0)

  await context.setOffline(true)
  const banner = page.getByRole('status').filter({ hasText: BANNER_OFFLINE })
  await expect(banner).toBeVisible()

  // Bant yüzen alt menü kartının üstünde durur (mobil)
  const bannerBox = (await banner.locator('.MuiAlert-root').boundingBox())!
  const nav = page.getByRole('navigation', { name: 'Alt menü' })
  const navBox = (await nav.boundingBox())!
  const qrButtonBox = (await nav.getByRole('link', { name: 'QR Tara' }).locator('span').first().boundingBox())!
  expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(navBox.y)
  expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(qrButtonBox.y)

  await context.setOffline(false)
  await expect(page.getByText('Bağlantı geri geldi')).toBeVisible()
  await expect(page.getByText(BANNER_OFFLINE)).toHaveCount(0)
  await expect(page.getByText('Bağlantı geri geldi')).toHaveCount(0, { timeout: 6_000 })
})

test('QR Tara: çevrimdışıyken işlem butonları kapalı, bağlantı gelince açılır', async ({ page, context }) => {
  await page.goto('/attendance/scan')
  const clockIn = page.getByRole('button', { name: /Giriş Yap/ })
  await expect(clockIn).toBeEnabled()

  await context.setOffline(true)
  await expect(clockIn).toBeDisabled()
  await expect(page.getByText(/İnternet bağlantısı yok\. Giriş, çıkış ve mola kayıtları/).first()).toBeVisible()
  // Devre dışı butona dokunmak tarayıcıyı/kamerayı açmaz
  await clockIn.click({ force: true })
  await expect(page.getByRole('heading', { name: 'QR Kodu Okutun' })).toHaveCount(0)

  const statusRefetch = page.waitForRequest((r) => r.url().endsWith('/api/attendance/current-status'))
  await context.setOffline(false)
  await statusRefetch
  await expect(clockIn).toBeEnabled()
})

test('Çalışma Özetim: çevrimiçi ziyaretten sonra çevrimdışında anlık görüntü gösterilir', async ({ page, context }) => {
  await page.goto('/my-schedule')
  const main = page.getByRole('main')
  await expect(main.getByText(/Plan: 09:00 – 17:00/).first()).toBeVisible()
  const cardsOnline = await main.getByText(/Plan: 09:00 – 17:00/).count()
  expect(cardsOnline).toBeGreaterThanOrEqual(28)

  // Anlık görüntü yazıldı (çalışan id'siyle anahtarlı)
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('shiftup:offline:')))
  expect(keys).toContain('shiftup:offline:my-schedule:emp-e2e-calisan')

  await context.setOffline(true)
  await expect(main.getByText(/Çevrimdışı — son güncelleme:/)).toBeVisible()
  await expect(main.getByText(/Plan: 09:00 – 17:00/)).toHaveCount(cardsOnline)
  await expect(main.getByText('Ayşe Yılmaz · Kasiyer')).toBeVisible()

  // Kaydedilmemiş ay → açık uyarı (eski ayın verisi gösterilmez)
  await main.getByRole('button', { name: 'Önceki ay' }).click()
  await expect(main.getByText(/bu ay için kaydedilmiş veri yok/)).toBeVisible()
  await expect(main.getByText(/Plan: 09:00 – 17:00/)).toHaveCount(0)
})
