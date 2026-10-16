/**
 * "Ana ekrana ekle" kartı: iPhone'da Safari yönergeleri, Android'de beforeinstallprompt ile
 * "Yükle". Kart alt menüyü ve ortadaki QR butonunu örtmemelidir.
 */
import { test, expect, bottomNav } from './support/fixtures'
import type { Page } from '@playwright/test'

test.use({ installPromptDismissed: false })

async function expectAboveBottomNav(page: Page) {
  const card = (await page.getByRole('dialog', { name: /ana ekrana ekle/ }).boundingBox())!
  const nav = bottomNav(page)
  const qr = (await nav.getByRole('link', { name: 'QR Tara' }).locator('span').first().boundingBox())!
  const navBox = (await nav.boundingBox())!
  expect(card.y + card.height).toBeLessThanOrEqual(navBox.y)
  expect(card.y + card.height).toBeLessThanOrEqual(qr.y)
}

test('iPhone: Safari "Ana Ekrana Ekle" yönergeleri; "Anladım" kalıcı olarak gizler', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iPhone 14', 'iOS UA gerekli')
  await page.goto('/my-schedule')
  const card = page.getByRole('dialog', { name: /ana ekrana ekle/ })
  await expect(card).toBeVisible()
  await expect(card.getByText('"Ana Ekrana Ekle"')).toBeVisible()
  await expect(card).toBeInViewport()
  await page.waitForTimeout(400) // Slide geçişi bitsin (konum ölçümü)
  await expectAboveBottomNav(page)

  await card.getByRole('button', { name: 'Anladım' }).click()
  await expect(card).toHaveCount(0)
  await page.reload()
  await expect(bottomNav(page)).toBeVisible()
  await expect(page.getByRole('dialog', { name: /ana ekrana ekle/ })).toHaveCount(0)
})

test('Android: beforeinstallprompt → "Yükle" tarayıcı penceresini açar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Pixel 7', 'Android/Chromium davranışı')
  await page.goto('/my-schedule')
  await expect(bottomNav(page).getByRole('link')).toHaveCount(5)

  // Gerçek olay yalnızca kurulabilirlik ölçütleri + kullanıcı etkileşimi sonrası gelir; taklit edilir
  await page.evaluate(() => {
    const w = window as unknown as { __promptCalls: number }
    w.__promptCalls = 0
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: string; platform: string }>
    }
    e.prompt = async () => {
      w.__promptCalls++
    }
    e.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' })
    window.dispatchEvent(e)
  })

  const card = page.getByRole('dialog', { name: /ana ekrana ekle/ })
  await expect(card).toBeVisible()
  await page.waitForTimeout(400)
  await expectAboveBottomNav(page)

  await card.getByRole('button', { name: 'Yükle' }).click()
  await expect(card).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls)).toBe(1)
  // Reddedildi → 7 gün boyunca tekrar sorulmaz
  const dismissedAt = await page.evaluate(() => localStorage.getItem('shiftup.installPrompt.dismissedAt'))
  expect(Number(dismissedAt)).toBeGreaterThan(0)
})
