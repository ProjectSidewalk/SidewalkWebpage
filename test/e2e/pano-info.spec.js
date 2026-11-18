/**
 * The Details (info) button opens a filled-in popover wherever a pano is shown (#4504). One class serves every page, so
 * a slip at one call site breaks only that page, as #4464 did on Explore. Validate's is in validate-interactions.
 */
const {test, expect, stubMapbox, serveAnyPano, waitForAppReady, readLabel, withoutMissingBackups} =
  require('./fixtures');

/**
 * Opens the Details popover and reads its values.
 * @param {import('@playwright/test').Page} page - The page, its pano shown.
 * @param {import('@playwright/test').Locator} scope - Where this page's info button sits.
 * @returns {Promise<Record<string, string>>} Each field's shown text, by its data-field name.
 */
async function openDetails(page, scope) {
  await scope.locator('#pano-info-button').click();
  const popover = page.locator('#pano-info-popover');
  await expect(popover).toBeVisible();
  return popover.locator('[data-field]').evaluateAll((fields) =>
    Object.fromEntries(fields.map((f) => [f.dataset.field, f.textContent.trim()])));
}

test('Explore\'s Details button shows the pano on screen', async ({page, context, consoleErrors}) => {
  await stubMapbox(context);
  // Dropping in by location skips the tutorial, whose overlays cover the button.
  const streets = await (await page.request.get('/v3/api/streets')).json();
  test.skip(!streets.features.length, 'the connected database has no streets');
  const [[lng1, lat1], [lng2, lat2]] = streets.features[0].geometry.coordinates;
  await page.goto(`/explore?lat=${((lat1 + lat2) / 2).toFixed(6)}&lng=${((lng1 + lng2) / 2).toFixed(6)}`);
  await waitForAppReady(page);
  await page.locator('#page-loading').waitFor({state: 'hidden'});
  // A first-time labeler's start pop-up sits over the pano until it is closed.
  await page.locator('#pop-up-message-button-holder button').click();

  const fields = await openDetails(page, page.locator('body'));
  expect(fields['image-id']).toBe(await page.evaluate(() => window.svl.panoManager.getPanoId()));
  expect(fields['street-id']).toMatch(/^\d+$/);
  expect(fields['region-id']).toMatch(/^\d+$/);
  expect(consoleErrors).toEqual([]);
});

test('Gallery\'s open card shows its label, and its Details button that label\'s pano', async ({page, context,
  consoleErrors}) => {
  // Lets the Maps stub stand in for a dev database's live panos.
  await serveAnyPano(context);
  await page.goto('/gallery');
  await waitForAppReady(page);
  await page.locator('#page-loading').waitFor({state: 'hidden'});
  const image = page.locator('.gallery-card .static-gallery-image').first();
  test.skip(await image.count() === 0, 'the connected database has no Gallery cards');
  const labelId = (await image.getAttribute('id')).replace('label_id_', '');

  // The holder, not the image: a missing crop covers the image with a placeholder.
  await page.locator('.gallery-card .image-holder').first().click();
  const card = page.locator('.gallery-expanded-view');
  await expect(card).toBeVisible();
  await expect(card.locator('.label-detail__pano-loading')).toBeHidden({timeout: 30_000});
  await expect(card.locator('.label-detail__title')).not.toBeEmpty();

  const fields = await openDetails(page, card);
  const labelLink = page.locator('#pano-info-popover [data-field="label-id"] a');
  await expect(labelLink).toHaveAttribute('href', `/label/${labelId}`);
  expect(fields['image-id']).toBe((await readLabel(page, labelId)).pano_id);
  expect(withoutMissingBackups(consoleErrors)).toEqual([]);
});
