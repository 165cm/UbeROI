// 通しのE2Eテスト（ビルドしたアプリをブラウザーで動かす）。単体テストは vitest（src/**/*.test.ts）
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/UbeROI/',
    timezoneId: 'Asia/Tokyo',
    locale: 'ja-JP',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/UbeROI/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
