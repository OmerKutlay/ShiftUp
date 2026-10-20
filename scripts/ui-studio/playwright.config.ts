/**
 * UI stüdyosu Playwright yapılandırması — bkz. capture.spec.ts.
 * Uygulama `next dev` ile çalışır (STUDIO_BASE_URL verilirse o adres kullanılır).
 */
import fs from 'node:fs'
import { defineConfig } from '@playwright/test'

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync('/opt/pw-browsers')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers'
}

const PORT = Number(process.env.STUDIO_PORT ?? 3200)
const FAKE_SUPABASE_PORT = 54329
const BASE_URL = process.env.STUDIO_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: '.',
  testMatch: 'capture.spec.ts',
  fullyParallel: true,
  workers: 4,
  timeout: 90_000,
  reporter: 'line',
  use: { baseURL: BASE_URL, browserName: 'chromium' },
  webServer: process.env.STUDIO_BASE_URL
    ? undefined
    : [
        {
          command: 'node ../../e2e/support/fake-supabase.mjs',
          url: `http://127.0.0.1:${FAKE_SUPABASE_PORT}/health`,
          reuseExistingServer: true,
          timeout: 10_000,
        },
        {
          command: `npx next dev -p ${PORT} -H 127.0.0.1`,
          cwd: '../..',
          url: `${BASE_URL}/manifest.json`,
          env: {
            NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE_SUPABASE_PORT}`,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'studio-placeholder',
            SUPABASE_SECRET_KEY: 'studio-placeholder',
            AUTH_MODE: 'production',
            NEXT_TELEMETRY_DISABLED: '1',
          },
          reuseExistingServer: true,
          timeout: 300_000,
        },
      ],
})
