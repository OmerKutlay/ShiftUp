/// <reference types="vitest" />
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react() as any], // eslint-disable-line @typescript-eslint/no-explicit-any
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Route testleri modülü her testte yeniden yükler (vi.resetModules); paralel koşuda ilk yükleme
    // birkaç saniye sürebilir — varsayılan 5 sn aralıklı zaman aşımı veriyordu
    testTimeout: 15_000,
    // e2e/: Playwright testleri (npm run test:e2e)
    exclude: [...configDefaults.exclude, 'e2e/**', 'scripts/ui-studio/**', 'playwright-report/**', 'test-results/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
