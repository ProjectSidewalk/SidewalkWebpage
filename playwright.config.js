/**
 * Playwright browser smoke suite (issue #4504). Loads core pages in headless Chromium and fails on any uncaught
 * page error or non-allowlisted console error — the runtime-error gate that compile/lint can't provide.
 *
 * The suite does NOT boot the app; it runs against whatever BASE_URL points at (default http://localhost:9000,
 * i.e. the dev app). CI boots a staged binary itself (.github/workflows/ci.yml, e2e-smoke job). Local setup and
 * usage: test/e2e/README.md.
 */
const {defineConfig, devices} = require('@playwright/test');

// The accessibility gate's specs, matched once and used for both the a11y project's testMatch and the smoke
// project's testIgnore — one definition, so a spec added to the gate cannot also run as part of the smoke half.
const A11Y_SPECS = /a11y[\w-]*\.spec\.js/;

module.exports = defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  // One CI retry absorbs one-off network flake (e.g. the api-docs previews fetch their style and tiles from Mapbox).
  retries: process.env.CI ? 1 : 0,
  // Fixed rather than the default half-the-cores: each worker carries its own Chromium, roughly a GB apiece on
  // top of the dev app's JVM and Postgres.
  workers: 2,
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:9000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Playwright empties a project's outputDir on every run and CI invokes the suite twice (gate, then smoke), so a
  // shared directory would drop the first run's traces before the artifact upload sees them.
  projects: [
    // Registers the throwaway user whose storageState the registered-user specs (dashboard.spec.js) reuse.
    {name: 'setup', testMatch: /auth\.setup\.js/, outputDir: 'test-results/setup'},
    // A project rather than a `--grep` on titles keeps CI's blocking/advisory split structural: rewording a test
    // cannot move it between the halves. No `dependencies` — nothing here needs a session, so the gate that blocks
    // merges does not ride on /signUp.
    {name: 'a11y', testMatch: A11Y_SPECS, use: {...devices['Desktop Chrome']},
      outputDir: 'test-results/a11y'},
    {name: 'chromium', testIgnore: A11Y_SPECS, use: {...devices['Desktop Chrome']},
      dependencies: ['setup'], outputDir: 'test-results/chromium'},
  ],
});
