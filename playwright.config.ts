import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/pixel',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // Where the template goldens live, and where they are committed from. The
  // plan names this path and Task 18's README repeats it; Playwright's default
  // would put them in `tests/pixel/templates.spec.ts-snapshots/` instead.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
