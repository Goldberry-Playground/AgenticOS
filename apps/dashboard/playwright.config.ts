import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      // Mobile lane (GOL-2651). Desktop Chrome was the only project, so CI
      // structurally could not catch a narrow-viewport regression — /settings
      // had been overflowing 390px by 68px since #673 with a green suite.
      // 390x844 is the iPhone 14/15 class viewport, the narrowest common phone.
      // Deliberately a chromium descriptor: the E2E workflow only installs the
      // chromium browser, so a webkit/Mobile Safari project would not run.
      name: "mobile-chromium",
      // Scoped to the responsive suite on purpose. `dashboard-load` and
      // `tab-isolation` assert on the `role="tab"` tablist, which is
      // `display: none` below 768px — the mobile nav is a dropdown button
      // instead — so running them here would be red by design rather than
      // by defect. Widening this lane means making those specs nav-aware
      // first; that is a separate piece of work.
      testMatch: /viewport-overflow\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      }
    }
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI
  }
});
