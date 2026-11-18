/**
 * Loads every admin page as an admin and fails on any uncaught error (#4276), which a server-side HTML check can't see.
 * The Owner-only pages are left out: the suite's admin is an Administrator, and /admin/health pings every live city.
 */
const {test, expect, serveAnyPano, signInAsAdmin, loadAndSettle, withoutMissingBackups} = require('./fixtures');

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

async function loadAsAdmin(page, context, path) {
  await signInAsAdmin(context);
  await loadAndSettle(page, context, {path, mapbox: true});
}

test.describe('admin pages', () => {
  for (const path of PAGES) {
    test(`${path} loads without console errors`, async ({page, context, consoleErrors}) => {
      await loadAsAdmin(page, context, path);
      expect(consoleErrors).toEqual([]);
    });
  }

  test('a user\'s admin pages load without console errors', async ({page, context, consoleErrors}) => {
    const username = await signInAsAdmin(context);
    for (const path of [`/admin/user/${username}`, `/admin/user/${username}/manage`]) {
      await loadAndSettle(page, context, {path, mapbox: true});
    }
    expect(consoleErrors).toEqual([]);
  });

  test('a team\'s admin page loads without console errors', async ({page, context, consoleErrors}) => {
    // Management lists the teams; CI's seed has one, a dev database may not.
    await loadAsAdmin(page, context, '/admin/management');
    await page.locator('#mgmt-teams a, #mgmt-teams .dq-empty').first().waitFor();
    const link = page.locator('#mgmt-teams a[href^="/admin/team/"]').first();
    if (!process.env.CI) test.skip(await link.count() === 0, 'the connected database has no teams');
    await loadAndSettle(page, context, {path: await link.getAttribute('href'), mapbox: true});
    expect(consoleErrors).toEqual([]);
  });

  test('a label\'s admin page loads without console errors', async ({page, context, consoleErrors}) => {
    const labels = (await (await page.request.get('/v3/api/rawLabels')).json()).features;
    test.skip(!labels.length, 'the connected database has no labels');
    // Lets the Maps stub stand in for a dev database's live panos.
    await serveAnyPano(context);
    await loadAsAdmin(page, context, `/admin/label/${labels[0].properties.label_id}`);
    expect(withoutMissingBackups(consoleErrors)).toEqual([]);
  });
});
