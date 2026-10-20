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
    // e2e/: Playwright testleri (npm run test:e2e); .claude/worktrees: yerel ajan çalışma ağaçları
    exclude: [...configDefaults.exclude, 'e2e/**', 'scripts/ui-studio/**', '.claude/worktrees/**', 'playwright-report/**', 'test-results/**'],
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
