/**
 * Playwright browser smoke suite (issue #4504). Loads core pages in headless Chromium and fails on any uncaught
 * page error or non-allowlisted console error — the runtime-error gate that compile/lint can't provide.
 *
 * The suite does NOT boot the app; it runs against whatever BASE_URL points at (default http://localhost:9000,
 * i.e. the dev app). CI boots a staged binary itself (.github/workflows/ci.yml, e2e-smoke job). Local setup and
 * usage: test/e2e/README.md.
 */
const {defineConfig, devices} = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // One CI retry absorbs one-off network flake (e.g. the api-docs pages load Leaflet from the unpkg CDN).
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:9000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Registers the throwaway user whose storageState the registered-user specs (dashboard.spec.js) reuse.
    {name: 'setup', testMatch: /auth\.setup\.js/},
    {name: 'chromium', use: {...devices['Desktop Chrome']}, dependencies: ['setup']},
  ],
});
