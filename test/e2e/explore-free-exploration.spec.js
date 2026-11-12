/**
 * Free exploration's way out of a pano with no links (#5968). The Maps stub answers every pano with no links and mints
 * one wherever a location search asks, so any drop-in lands link-less and the arrow's walk always finds a pano ahead.
 */
const {test, expect, stubMapbox, waitForAppReady} = require('./fixtures');

test('a free-exploration pano with no links offers a forward arrow that walks the street', async ({page, context,
  consoleErrors}) => {
  await stubMapbox(context);

  // Inside a street's first segment, so the drop-in resolves to that street and not one it meets; a segment long
  // enough (about 55 m of latitude or more of longitude) that the walk has street left to step along.
  const streets = await (await page.request.get('/v3/api/streets')).json();
  const coords = streets.features.map((f) => f.geometry.coordinates)
    .find(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.0005);
  test.skip(!coords, 'the connected database has no street with a long first segment');
  const lng = (coords[0][0] + coords[1][0]) / 2;
  const lat = (coords[0][1] + coords[1][1]) / 2;

  await page.goto(`/explore?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`);
  await waitForAppReady(page);
  await page.locator('#page-loading').waitFor({state: 'hidden'});

  const currentPano = () => page.evaluate(() => window.svl.panoManager.getPanoId());
  const links = await page.evaluate(() => window.svl.panoManager.panoViewer.getLinkedPanos());
  test.skip(links.length > 0, 'this city\'s imagery is not Google\'s, so the stub did not make the pano link-less');
  const startPano = await currentPano();

  // A first-time labeler's start pop-up holds walking, and the arrows with it, until it is closed.
  await page.locator('#pop-up-message-button-holder button').click();

  const arrows = page.locator('#nav-arrows-container image');
  await expect(arrows).toHaveCount(1);
  await expect(arrows).toHaveClass(/route-forward-arrow/);

  await arrows.click();
  await expect.poll(currentPano, 'the forward arrow did not move the labeler').not.toBe(startPano);

  expect(consoleErrors).toEqual([]);
});
