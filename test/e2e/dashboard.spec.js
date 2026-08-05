/**
 * Smoke tests for pages that require a REGISTERED (non-anonymous) user. Reuses the session that
 * auth.setup.js saved as storageState; anonymous sessions get bounced to /signIn by WithSignedIn().
 */
const {test, expect, stubMapbox, waitForAppReady, STORAGE_STATE} = require('./fixtures');

test.use({storageState: STORAGE_STATE});

test('/dashboard loads without console errors', async ({page, context, consoleErrors}) => {
  await stubMapbox(context); // The contribution choropleth is a Mapbox map.
  const response = await page.goto('/dashboard');
  expect(response.status(), `/dashboard responded ${response.status()}`).toBeLessThan(400);
  // A bounced anonymous/expired session would land on /signIn with a clean console — assert we stayed put.
  expect(page.url()).toContain('/dashboard');
  await waitForAppReady(page);
  await page.waitForTimeout(1000);
  expect(consoleErrors).toEqual([]);
});
