/**
 * Loads every admin page as an admin and fails on any uncaught error (#4276), which a server-side HTML check can't see.
 * The Owner-only pages are left out: the suite's admin is an Administrator, and /admin/health pings every live city.
 */
const base = require('./fixtures');
const {expect, serveAnyPano, signInAsAdmin, loadAndSettle, stubMapbox, requireData, firstGalleryLabelId,
  withoutMissingBackups} = base;

// Both, though one page: /admin is its own route, and #4276's bug was on it alone.
const PAGES = [
  '/admin',
  '/admin/overview',
  '/admin/coverage',
  '/admin/street-status',
  '/admin/imagery',
  '/admin/sidewalks',
  '/admin/label-map',
  '/admin/quality',
  '/admin/contributors',
  '/admin/activity',
  '/admin/stories',
  '/admin/humans-vs-ai',
  '/admin/api-analytics',
  '/admin/management',
  '/admin/partners',
  '/admin/goldExamples',
];

const test = base.test.extend({
  // One sign-in per worker: one per test spends the hourly login limit in a few reruns.
  admin: [async ({browser}, use, workerInfo) => {
    const context = await browser.newContext({baseURL: workerInfo.project.use.baseURL});
    const username = await signInAsAdmin(context);
    const storageState = await context.storageState();
    await context.close();
    await use({username, storageState});
  }, {scope: 'worker'}],
  storageState: async ({admin}, use) => use(admin.storageState),

  /**
   * Loads an admin page and waits out its requests: the pages fetch their data after they report ready, so their
   * tables and charts draw after loadAndSettle's settle window.
   */
  loadAdminPage: async ({page, context}, use) => {
    await stubMapbox(context);
    const pending = new Set();
    page.on('request', (r) => pending.add(r));
    for (const done of ['requestfinished', 'requestfailed']) page.on(done, (r) => pending.delete(r));
    await use(async (path) => {
      await loadAndSettle(page, context, {path});
      await expect.poll(() => pending.size, {message: `${path} kept requests open`, timeout: 30_000}).toBe(0);
      await page.waitForTimeout(500);
    });
  },
});

test.describe('admin pages', () => {
  for (const path of PAGES) {
    test(`${path} loads without console errors`, async ({loadAdminPage, consoleErrors}) => {
      await loadAdminPage(path);
      expect(consoleErrors).toEqual([]);
    });
  }

  test('a user\'s admin pages load without console errors', async ({admin, loadAdminPage, consoleErrors}) => {
    await loadAdminPage(`/admin/user/${admin.username}`);
    await loadAdminPage(`/admin/user/${admin.username}/manage`);
    expect(consoleErrors).toEqual([]);
  });

  test('a team\'s admin page loads without console errors', async ({page, loadAdminPage, consoleErrors}) => {
    await loadAdminPage('/admin/management');
    const link = page.locator('#mgmt-teams a[href^="/admin/team/"]').first();
    requireData(await link.count() > 0, 'teams');
    await loadAdminPage(await link.getAttribute('href'));
    expect(consoleErrors).toEqual([]);
  });

  test('a label\'s admin page loads without console errors', async ({page, context, loadAdminPage,
    consoleErrors}) => {
    // Lets the Maps stub stand in for a dev database's live panos.
    await serveAnyPano(context);
    const labelId = await firstGalleryLabelId(page, context);
    await loadAdminPage(`/admin/label/${labelId}`);
    await expect(page.locator('.label-detail__pano-loading')).toBeHidden({timeout: 30_000});
    expect(withoutMissingBackups(consoleErrors)).toEqual([]);
  });
});
