/**
 * Mobil gezinme: rol bazlı alt menü sekmeleri, aria-current, /more sayfası ve alt menünün
 * sayfa içeriğini örtmemesi.
 */
import { test, expect, bottomNav } from './support/fixtures'

const EMPLOYEE_TABS = ['Vardiyam', 'Plan', 'QR Tara', 'İzin', 'Daha fazla']
const MANAGER_TABS = ['Bugün', 'Plan', 'QR Tara', 'Bildirimler', 'Daha fazla']

/** Alt menüdeki bağlantıların erişilebilir adları (aria-label varsa o, yoksa metin) */
async function tabNames(page: import('@playwright/test').Page) {
  const links = bottomNav(page).getByRole('link')
  await expect(links).toHaveCount(5)
  return links.evaluateAll((els) =>
    els.map((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim())
  )
}

test.describe('Çalışan alt menüsü', () => {
  test.use({ role: 'Çalışan' })

  test('sekmeler Vardiyam/Plan/QR/İzin/Daha fazla; gezinme aria-current günceller', async ({ page, unmockedApiCalls }) => {
    await page.goto('/my-schedule')
    const nav = bottomNav(page)
    await expect(nav).toBeVisible()
    expect(await tabNames(page)).toEqual(EMPLOYEE_TABS)

    const vardiyam = nav.getByRole('link', { name: 'Vardiyam' })
    await expect(vardiyam).toHaveAttribute('aria-current', 'page')
    await expect(vardiyam).toHaveAttribute('href', '/my-schedule')

    await nav.getByRole('link', { name: 'İzin' }).click()
    await expect(page).toHaveURL(/\/leave$/)
    await expect(nav.getByRole('link', { name: 'İzin' })).toHaveAttribute('aria-current', 'page')
    await expect(vardiyam).not.toHaveAttribute('aria-current', 'page')

    await nav.getByRole('link', { name: 'QR Tara' }).click()
    await expect(page).toHaveURL(/\/attendance\/scan$/)
    await expect(nav.getByRole('link', { name: 'QR Tara' })).toHaveAttribute('aria-current', 'page')

    await nav.getByRole('link', { name: 'Daha fazla' }).click()
    await expect(page).toHaveURL(/\/more$/)
    await expect(nav.getByRole('link', { name: 'Daha fazla' })).toHaveAttribute('aria-current', 'page')
    // Yalnızca bir sekme aktif
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)

    // /leave sayfasının kendi uçları bu smoke testin kapsamı dışında; çekirdek uçlar taklit edildi
    expect(unmockedApiCalls.filter((c) => !c.includes('/api/leave'))).toEqual([])
  })

  test('/more: alt menüde olmayan öğeler gruplu listelenir + Çıkış Yap', async ({ page }) => {
    await page.goto('/more')
    const main = page.getByRole('main')
    await expect(main.getByText('Ayşe Yılmaz')).toBeVisible()

    for (const label of ['Açık vardiyalar', 'Mesai düzeltme', 'Bildirimler']) {
      await expect(main.getByRole('link', { name: label })).toBeVisible()
    }
    // Alt menüde olanlar ve yönetici sayfaları listelenmez
    for (const label of ['Çalışma özetim', 'Haftalık plan', 'QR Tara', 'İzinler', 'Raporlar', 'Çalışanlar', 'Ayarlar']) {
      await expect(main.getByRole('link', { name: label })).toHaveCount(0)
    }
    await expect(main.getByRole('heading', { name: 'Planlama' })).toBeVisible()
    await expect(main.getByRole('button', { name: 'Çıkış Yap' })).toBeVisible()

    await main.getByRole('link', { name: 'Açık vardiyalar' }).click()
    await expect(page).toHaveURL(/\/open-shifts$/)
    // Alt menüde olmayan sayfada "Daha fazla" aktif sayılır
    await expect(bottomNav(page).getByRole('link', { name: 'Daha fazla' })).toHaveAttribute('aria-current', 'page')
  })

  test('Çıkış Yap → /api/auth/logout çağrılır ve /login açılır', async ({ page }) => {
    await page.goto('/more')
    const logout = page.waitForRequest((r) => r.url().endsWith('/api/auth/logout') && r.method() === 'POST')
    await page.getByRole('main').getByRole('button', { name: 'Çıkış Yap' }).click()
    await logout
    await expect(page).toHaveURL(/\/login/)
  })

  test('alt menü uzun sayfanın son öğesini örtmez', async ({ page }) => {
    await page.goto('/my-schedule')
    const main = page.getByRole('main')
    // Ayın tüm günleri listelenir → sayfa ekrandan uzun
    await expect(main.getByText('09:00–17:00', { exact: true }).filter({ visible: true }).last()).toBeVisible()

    const isLong = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight * 1.5)
    expect(isLong).toBe(true)

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForFunction(
      () => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1
    )

    const geometry = await page.evaluate(() => {
      const mainEl = document.querySelector('main')!
      // main içindeki görünür boyutlu en alttaki yaprak öğe (sarmalayıcı kutular main'i doldurur)
      let lastBottom = 0
      for (const el of Array.from(mainEl.querySelectorAll('*'))) {
        if (el.childElementCount > 0) continue
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) lastBottom = Math.max(lastBottom, r.bottom)
      }
      const nav = document.querySelector('nav[aria-label="Alt menü"]')!
      const navRect = nav.getBoundingClientRect()
      // Görünen kartın ve sekmelerin en üst noktası
      let navTop = navRect.top
      for (const el of Array.from(nav.querySelectorAll('*'))) {
        navTop = Math.min(navTop, el.getBoundingClientRect().top)
      }
      return { lastBottom, navBarTop: navRect.top, navTop, viewport: window.innerHeight, navBottom: navRect.bottom }
    })

    expect(geometry.navBottom).toBeCloseTo(geometry.viewport, 0)
    // Son içerik öğesi alt menü kartının üstünde kalmalı
    expect(geometry.lastBottom).toBeLessThanOrEqual(geometry.navTop + 0.5)
  })
})

test.describe('Çalışan: Günlük operasyon', () => {
  test.use({ role: 'Çalışan' })

  test('Daha fazla › Operasyon altından /daily açılır; ana sayfa Vardiyam kalır', async ({ page, unmockedApiCalls }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/my-schedule$/)

    await page.goto('/more')
    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { name: 'Operasyon' })).toBeVisible()
    await main.getByRole('link', { name: 'Günlük operasyon' }).click()
    await expect(page).toHaveURL(/\/daily$/)
    await expect(page.getByText('Bugün vardiya yok')).toBeVisible()
    await expect(bottomNav(page).getByRole('link', { name: 'Daha fazla' })).toHaveAttribute('aria-current', 'page')
    expect(unmockedApiCalls).toEqual([])
  })
})

test.describe('Yönetici alt menüsü', () => {
  test.use({ role: 'Mağaza Müdürü' })

  test('sekmeler Bugün/Plan/QR/Bildirimler/Daha fazla; gezinme aria-current günceller', async ({ page }) => {
    await page.goto('/notifications')
    const nav = bottomNav(page)
    expect(await tabNames(page)).toEqual(MANAGER_TABS)
    await expect(nav.getByRole('link', { name: 'Bildirimler' })).toHaveAttribute('aria-current', 'page')

    await nav.getByRole('link', { name: 'Plan' }).click()
    await expect(page).toHaveURL(/\/schedule$/)
    await expect(nav.getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: 'Bildirimler' })).not.toHaveAttribute('aria-current', 'page')

    await nav.getByRole('link', { name: 'Bugün' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(nav.getByRole('link', { name: 'Bugün' })).toHaveAttribute('aria-current', 'page')
  })

  test('/more: yönetici sayfaları listelenir', async ({ page }) => {
    await page.goto('/more')
    const main = page.getByRole('main')
    await expect(main.getByText('Mehmet Müdür')).toBeVisible()
    // Günlük operasyon "Bugün" sekmesi olsa da Operasyon grubunda adıyla da listelenir
    for (const label of ['Genel bakış', 'Günlük operasyon', 'Çalışanlar', 'Raporlar', 'Ayarlar', 'QR Kiosk', 'İzinler']) {
      await expect(main.getByRole('link', { name: label })).toBeVisible()
    }
    // Alt menüdekiler tekrar edilmez
    await expect(main.getByRole('link', { name: 'Bildirimler' })).toHaveCount(0)
    await expect(main.getByRole('button', { name: 'Çıkış Yap' })).toBeVisible()
  })
})
