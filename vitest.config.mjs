/**
 * Vitest configuration for the jsdom unit suite in test/js/. Run it with `make test-js` (`args=--coverage` for the
 * report CI gates on); see test/js/README.md.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests render into a DOM, so run them under jsdom (provides window/document).
    environment: 'jsdom',
    // The page's address is `http://localhost/`, as the suites' expected URLs were written for.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },

    // Each file gets a VM context whose global is the jsdom window, so `window.X = fake` is a page global to the
    // modules under test and `view: window` is a real Window; it is also the fastest pool here (workers are reused).
    pool: 'vmForks',

    // Pinned west of Greenwich, so a date bug that only shows there (a UTC timestamp near midnight printing as the
    // month before) fails here rather than only for the labelers it reaches.
    env: { TZ: 'America/Los_Angeles' },

    setupFiles: ['test/js/setup.js'],

    // `describe`, `it`, `expect`, `vi` and the hooks as globals, the way the suites were written.
    globals: true,

    include: ['test/js/**/*.test.js'],

    // Spies and `vi.stubGlobal` stubs are undone, and every mock's call history emptied, before each test, so no
    // suite needs an afterEach for it. Fake timers are put back by `setup.js`.
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,

    coverage: {
      // The whole first-party frontend, so an untested file counts against the ratio rather than being invisible.
      include: ['frontend/js/**/*.js'],
      // The default per-file table is 229 rows of mostly zeroes, which buries the totals; lcov keeps the detail.
      reporter: ['text-summary', 'lcov'],
      // No `thresholds` yet: the number is a baseline to grow from before it becomes a floor.
    },
  },
});
