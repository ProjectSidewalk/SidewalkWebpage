/**
 * Smoke tests for every admin page (#4276), signed in as the CI seed's Owner: each must load its entry script and run
 * it without an uncaught error or console error. An admin page once shipped to prod throwing `Admin is not defined`,
 * which compile, lint and the HTTP-level specs all passed.
 *
 * The pages come from conf/routes rather than a hand-kept list, so a new admin page is covered the day it lands. Its
 * dynamic segments are filled from PARAMS, which point at rows ci-seed.sql creates.
 */
const fs = require('fs');
const path = require('path');
const {test, expect, loadAndSettle, ADMIN_STORAGE_STATE} = require('./fixtures');

// A value for each dynamic segment an admin page route declares, all rows in test/e2e/fixtures/ci-seed.sql.
const PARAMS = {
  teamId: 900001, // CI Seed Team.
  username: 'ciSeedLabeler1', // A user with missions, labels, and a team.
  labelId: 900002, // A label on an expired pano with a backup, so its PanoViewer renders from disk.
};

// GET /admin and GET /admin/..., but not the /adminapi data routes or /adminValidate.
const ADMIN_PAGES = [...fs.readFileSync(path.join(__dirname, '..', '..', 'conf', 'routes'), 'utf8')
  .matchAll(/^GET\s+(\/admin(?:\/\S*)?)\s/gm)].map((match) => match[1]);

test('route discovery finds the admin pages', () => {
  // Vacuity guard: a change to the routes file's layout would otherwise leave this spec testing nothing.
  expect(ADMIN_PAGES).toContain('/admin/overview');
});

// The session auth.setup.js saved, or none when it found no seeded Owner (a dev database), in which case tests skip.
// Playwright reads fixture dependencies from the destructuring, so an empty pattern is how a fixture declares none.
// eslint-disable-next-line no-empty-pattern
test.use({storageState: async ({}, use) => use(fs.existsSync(ADMIN_STORAGE_STATE) ? ADMIN_STORAGE_STATE : undefined)});

for (const route of ADMIN_PAGES) {
  test(`${route} loads without console errors`, async ({page, context, consoleErrors}) => {
    test.skip(!fs.existsSync(ADMIN_STORAGE_STATE), 'no admin session: this database has no seeded ciSeedOwner');
    const segments = [...route.matchAll(/[:*$](\w+)/g)].map((match) => match[1]);
    const missing = segments.filter((name) => !(name in PARAMS));
    expect(missing, 'add a value for each of these route segments to PARAMS in admin.spec.js').toEqual([]);

    await loadAndSettle(page, context, {path: route.replace(/[:*$](\w+)/g, (_, name) => PARAMS[name]), mapbox: true});
    // Rendered the page itself, not an error page or a template that lost its script.
    await expect(page.locator('#page-entry')).toHaveCount(1);
    expect(consoleErrors).toEqual([]);
  });
}
