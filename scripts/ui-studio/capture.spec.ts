/**
 * UI stüdyosu — veritabanı olmadan her sayfanın ekran görüntüsü.
 *
 *   npx playwright test -c scripts/ui-studio/playwright.config.ts
 *
 * Ortam:
 *   STUDIO_OUT     çıktı klasörü (varsayılan: scripts/ui-studio/out)
 *   STUDIO_ONLY    virgüllü çekim adı filtresi (ör. "reports-attendance,today")
 *   STUDIO_DEVICE  desktop | mobile (varsayılan: ikisi)
 *   STUDIO_PERSONA manager | employee | anon
 *   STUDIO_FOLD    1 → mobilde ayrıca yalnızca ilk ekranın görüntüsü (…--fold.png): sabit üst/alt bar
 *
 * Oturum e2e/support/fake-supabase.mjs ile doğrulanır; /api/* uçları mocks.ts'den yanıtlanır.
 */
import fs from 'node:fs'
import path from 'node:path'
import { test, type Page } from '@playwright/test'
import { addSessionCookie } from '../../e2e/support/fixtures'
import { mockApiResponse, type Persona as ApiPersona } from './mocks'
import { SHOTS, type Persona, type Shot, type Step } from './shots'

const OUT = process.env.STUDIO_OUT ?? path.join(__dirname, 'out')
const ONLY = process.env.STUDIO_ONLY?.split(',').map((s) => s.trim()).filter(Boolean)
const DEVICE = process.env.STUDIO_DEVICE
const PERSONA = process.env.STUDIO_PERSONA
const FOLD = process.env.STUDIO_FOLD === '1'

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
} as const

const unmocked = new Set<string>()
const problems: string[] = []

async function applyStep(page: Page, step: Step) {
  if ('wait' in step) return page.waitForTimeout(step.wait)
  const loc = 'tab' in step
    ? page.getByRole('tab', { name: step.tab })
    : 'button' in step
      ? page.getByRole('button', { name: step.button })
      : page.locator(step.click)
  await loc.first().click({ timeout: 4000 })
  await page.waitForTimeout(500)
}

/** Ağ ve animasyonlar dursun */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(700)
}

for (const [device, opts] of Object.entries(DEVICES)) {
  if (DEVICE && DEVICE !== device) continue
  test.describe(device, () => {
    test.use({ ...opts, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', serviceWorkers: 'block' })

    for (const shot of SHOTS as Shot[]) {
      if (ONLY && !ONLY.includes(shot.name)) continue
      if (shot.devices && !shot.devices.includes(device as 'desktop' | 'mobile')) continue
      for (const persona of shot.personas as Persona[]) {
        if (PERSONA && PERSONA !== persona) continue
        const file = `${device}--${persona}--${shot.name}.png`
        test(file, async ({ page, context, baseURL }) => {
          if (persona !== 'anon') {
            await addSessionCookie(context, baseURL!, persona === 'manager' ? 'Mağaza Müdürü' : 'Çalışan')
          }
          await context.addInitScript(() => {
            try {
              localStorage.setItem('shiftup.installPrompt.dismissedAt', String(Date.now()))
              localStorage.setItem('shiftup.pushPrompt.dismissedAt', String(Date.now()))
            } catch { /* yok say */ }
          })
          await context.route((u) => u.pathname.startsWith('/api/'), async (route) => {
            const req = route.request()
            const url = new URL(req.url())
            let body: unknown = null
            try { body = req.postDataJSON() } catch { body = null }
            const apiPersona: ApiPersona = persona === 'anon' ? 'employee' : persona
            if (persona === 'anon' && url.pathname === '/api/auth/me') {
              return route.fulfill({ status: 401, contentType: 'application/json', body: '{"employee":null}' })
            }
            const res = mockApiResponse(req.method(), url, apiPersona, body)
            if (!res) {
              unmocked.add(`${req.method()} ${url.pathname}`)
              return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"studio: taklit yok"}' })
            }
            return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) })
          })
          const errors: string[] = []
          page.on('pageerror', (e) => errors.push(e.message))

          await page.goto(shot.path)
          await settle(page)
          for (const step of shot.steps ?? []) {
            try {
              await applyStep(page, step)
            } catch {
              problems.push(`${file}: adım bulunamadı ${JSON.stringify(step, (_k, v) => (v instanceof RegExp ? String(v) : v))}`)
            }
          }
          await settle(page)
          // Next.js geliştirme rozeti görüntüye girmesin
          await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
          fs.mkdirSync(OUT, { recursive: true })
          if (FOLD && device === 'mobile' && !shot.viewportOnly) {
            await page.screenshot({ path: path.join(OUT, file.replace('.png', '--fold.png')) })
          }
          await page.screenshot({ path: path.join(OUT, file), fullPage: !shot.viewportOnly })
          if (errors.length) problems.push(`${file}: sayfa hatası: ${errors.join(' | ')}`)
        })
      }
    }
  })
}

test.afterAll(() => {
  fs.mkdirSync(OUT, { recursive: true })
  const report = [
    `taklit edilmeyen: ${[...unmocked].sort().join(', ') || 'yok'}`,
    ...problems,
  ].join('\n')
  fs.appendFileSync(path.join(OUT, 'report.txt'), report + '\n')
})
