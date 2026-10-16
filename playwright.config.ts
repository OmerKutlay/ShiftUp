/**
 * Playwright e2e — mobil PWA smoke testleri (e2e/).
 *
 * Uygulama production build olarak çalışır (`next build --webpack && next start`): Service Worker
 * yalnızca production'da kaydedilir. Supabase yerine e2e/support/fake-supabase.mjs (yalnızca
 * oturum doğrulaması) kullanılır; sayfaların çağırdığı /api/* uçları testlerde
 * context.route() ile taklit edilir — gerçek ağ / veritabanı yok.
 *
 * Tarayıcı: yalnızca Chromium. iPhone 14 projesi WebKit değil, iPhone viewport + UA'sı ile
 * Chromium'dur. Yerel ortamda önceden kurulu /opt/pw-browsers kullanılır (varsa); CI'da
 * `npx playwright install --with-deps chromium` ile kurulur.
 *
 * E2E_SKIP_BUILD=1 → build adımı atlanır (CI'da build ayrı adımdır).
 * E2E_BASE_URL verilirse sunucu başlatılmaz, o adres test edilir.
 */
import fs from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const PREINSTALLED_BROWSERS = '/opt/pw-browsers'
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(PREINSTALLED_BROWSERS)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = PREINSTALLED_BROWSERS
}

// Chromium: Service Worker'ın kendi istekleri de context.route() ve setOffline() kapsamına girsin
// (yoksa SW, taklitleri ve çevrimdışı emülasyonunu atlayıp gerçek sunucuya gider).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const FAKE_SUPABASE_PORT = Number(process.env.FAKE_SUPABASE_PORT ?? 54329)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

/** Build ve sunucu için ortam: Supabase URL'si sahte yerel sunucuya işaret eder (build'e gömülür) */
const serverEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE_SUPABASE_PORT}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'e2e-placeholder-publishable-key',
  SUPABASE_SECRET_KEY: 'e2e-placeholder-secret-key',
  AUTH_MODE: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
}

const appCommand = process.env.E2E_SKIP_BUILD
  ? `npx next start -p ${PORT} -H 127.0.0.1`
  : `npx next build --webpack && npx next start -p ${PORT} -H 127.0.0.1`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    // Varsayılan: SW engelli (route() taklitleri doğrudan sayfaya uygulanır, testler birbirini
    // etkilemez). SW davranışını test eden dosyalar `serviceWorkers: 'allow'` kullanır.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'Pixel 7',
      use: { ...devices['Pixel 7'] },
    },
    {
      // WebKit kurulu değil: iPhone 14 viewport/UA/dokunmatik özellikleri Chromium üzerinde
      name: 'iPhone 14',
      use: { ...devices['iPhone 14'], browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'node e2e/support/fake-supabase.mjs',
          url: `http://127.0.0.1:${FAKE_SUPABASE_PORT}/health`,
          env: { FAKE_SUPABASE_PORT: String(FAKE_SUPABASE_PORT) },
          reuseExistingServer: !process.env.CI,
          timeout: 10_000,
        },
        {
          command: appCommand,
          url: `${BASE_URL}/manifest.json`,
          env: serverEnv,
          reuseExistingServer: !process.env.CI,
          timeout: 600_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      ],
})
