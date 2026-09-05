/**
 * Smoke tests for pages that require a REGISTERED (non-anonymous) user. Reuses the session that
 * auth.setup.js saved as storageState; anonymous sessions get bounced to /signIn by WithSignedIn() —
 * loadAndSettle's stayed-put URL assert is what catches that.
 */
const {test, expect, loadAndSettle, STORAGE_STATE} = require('./fixtures');

test.use({storageState: STORAGE_STATE});

test('/dashboard loads without console errors', async ({page, context, consoleErrors}) => {
  await loadAndSettle(page, context, {path: '/dashboard', mapbox: true}); // The choropleth is a Mapbox map.
  expect(consoleErrors).toEqual([]);
});
