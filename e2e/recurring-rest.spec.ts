/**
 * Tekrarlayan haftalık tatilin süresi: atama diyaloğunda "Her <gün>…" → süre (ör. 3 ay, N hafta) → istek
 * recurring_until taşır; editörde "Her hafta tatil" taşının süresi oktan seçilir.
 */
import type { Route } from '@playwright/test'
import { test, expect, makeEmployee, mockApi } from './support/fixtures'

const STORE = { active: { id: 'store-1', name: 'Kadıköy Şube' }, home_store_id: 'store-1', can_switch: false }
const manager = makeEmployee('Mağaza Müdürü')
const cashier = { ...makeEmployee('Çalışan'), id: 'emp-e2e-kasiyer', full_name: 'Şule Işık' }

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

let posts: Array<Record<string, unknown>> = []

const overrides: Record<string, unknown | ((route: Route) => Promise<void> | void)> = {
  '/api/auth/me': { employee: manager, store: STORE },
  '/api/employees': { employees: [manager, cashier] },
  '/api/shift-templates': { templates: [] },
  '/api/shifts': { assignments: [] },
  '/api/holidays': { holidays: [] },
  '/api/availability': { availability: [] },
  '/api/leave-types': {
    types: [{
      id: 'lt-1', name: 'Yıllık izin', base_type: 'annual', employee_requestable: true, active: true,
      sort_order: 10, system_key: 'annual',
    }],
  },
  '/api/leave': (route: Route) => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON() as Record<string, unknown>)
      return route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ request: { id: 'lv-1' }, kept_worked_shifts: 0, recurring: { created: 12, skipped: 0 } }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [] }) })
  },
}

test.use({ role: 'Mağaza Müdürü' })

test.beforeEach(async ({ context, page }) => {
  void page
  posts = []
  await mockApi(context, { role: 'Mağaza Müdürü', overrides })
})

test('atama diyaloğu: her hafta tatil 3 ay ve 8 hafta süreyle atanır', async ({ page }, info) => {
  await page.goto('/schedule')
  await page.getByRole('main').getByText('Şule Işık').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: /Tatil \/ izin/ }).click()
  await page.getByRole('menuitem', { name: /^Her .+…/ }).click()
  await expect(dialog.getByText('Ne kadar sürsün?')).toBeVisible()
  await expect(dialog.getByText(/Bitiş yok/)).toBeVisible()

  await dialog.getByRole('radio', { name: '3 ay' }).click()
  await expect(dialog.getByText(/\d+ hafta · son tatil/)).toBeVisible()
  await page.screenshot({ path: info.outputPath('dialog-3ay.png') })

  // Hafta sayısı: geçersizken "Tatil yap" kapalı
  await dialog.getByRole('radio', { name: 'Hafta sayısı' }).click()
  const weeks = dialog.getByRole('spinbutton')
  await weeks.fill('1')
  await expect(dialog.getByRole('button', { name: 'Tatil yap' })).toBeDisabled()
  await weeks.fill('8')
  await expect(dialog.getByText(/^8 hafta · son tatil/)).toBeVisible()
  await page.screenshot({ path: info.outputPath('dialog-8hafta.png') })
  await dialog.getByRole('button', { name: 'Tatil yap' }).click()

  await expect.poll(() => posts.length).toBe(1)
  const body = posts[0]
  expect(body).toMatchObject({ leave_type: 'weekly_rest', recurring: true })
  const start = new Date(`${body.start_date}T00:00:00`)
  start.setDate(start.getDate() + 7 * 7)
  expect(body.recurring_until).toBe(ymd(start))
})

test('editör: "Her hafta tatil" taşının süresi seçilir', async ({ page }, info) => {
  await page.goto('/schedule')
  await page.getByRole('button', { name: 'Vardiya ekle' }).last().click()
  const bar = page.getByRole('toolbar', { name: 'Plan editörü' })
  await expect(bar).toBeVisible()

  await bar.getByRole('button', { name: 'Tekrar süresini seç' }).click()
  await page.getByRole('radio', { name: '6 ay' }).click()
  await page.screenshot({ path: info.outputPath('editor-popover.png') })
  await page.getByRole('button', { name: 'Tamam' }).click()

  const stone = bar.getByRole('radio', { name: 'Her hafta tatil · 6 ay' })
  await expect(stone).toHaveAttribute('data-state', 'on')
  await page.screenshot({ path: info.outputPath('editor-bar.png') })
})
