/**
 * Behavior tests for /labelMap's viewport-scoped label feed (#5002): the page requests `/labels/all` with a
 * bbox, skips refetching while the view stays inside the padded fetched area, and refetches when it escapes.
 *
 * Every case intercepts the feed (these assert request behavior, not data), so they behave identically
 * against a seeded dev schema and CI's empty one. The zoom floor is exercised in the jest suite
 * (test/js/viewportLabelLoader.test.js) instead — mobile emulation plus zoom thresholds are flaky here.
 */
const {test, expect, stubMapbox, waitForAppReady} = require('./fixtures');

const EMPTY_FEED = '{"type":"FeatureCollection","features":[]}';

/** Routes the label feed into `urls`, always answering with a well-formed empty collection. */
async function recordLabelFeed(context, urls) {
  await context.route('**/labels/all*', (route) => {
    urls.push(new URL(route.request().url()));
    return route.fulfill({status: 200, contentType: 'application/json', body: EMPTY_FEED});
  });
}

/** Waits until the page promise has exposed the map (window.map.map is the mapboxgl.Map). */
async function waitForMap(page) {
  await page.waitForFunction(() => Boolean(window.map && window.map.map));
}

test.describe('/labelMap viewport-scoped feed', () => {
  test('a desktop load issues exactly one bbox-scoped request, and a small pan issues none', async ({
    page, context,
  }) => {
    await stubMapbox(context);
    const feedUrls = [];
    await recordLabelFeed(context, feedUrls);

    await page.goto('/labelMap');
    await waitForAppReady(page);
    await expect.poll(() => feedUrls.length, {message: 'the initial viewport fetch should go out'}).toBe(1);
    expect(feedUrls[0].searchParams.get('bbox')).toMatch(/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/);

    // The fetch is padded well beyond the viewport, so a small pan must stay inside it and cost nothing.
    await waitForMap(page);
    await page.evaluate(() => window.map.map.panBy([50, 50], {animate: false}));
    await page.waitForTimeout(1000); // Longer than the loader's debounce.
    expect(feedUrls.length).toBe(1);
  });

  test('moving beyond the fetched area refetches with a new bbox', async ({page, context}) => {
    await stubMapbox(context);
    const feedUrls = [];
    await recordLabelFeed(context, feedUrls);

    // A viewport deep link opens the map zoomed in, so the first fetch covers blocks rather than the whole
    // city — at the city-wide default the padded first fetch can cover all of maxBounds, and then no move
    // could ever escape it (the one-fetch invariant the first test pins).
    const cityParams = await (await page.request.get('/cityMapParams')).json();
    const {lat, lng} = cityParams.city_center;
    await page.goto(`/labelMap?lat=${lat}&lng=${lng}&zoom=17`);
    await waitForAppReady(page);
    await expect.poll(() => feedUrls.length, {message: 'the initial viewport fetch should go out'}).toBe(1);

    // Jump far outside the padded fetch area: a zoom-17 viewport spans ~0.003°, so 0.02° clears it even
    // after padding (and stays inside any deployment city's bounds).
    await waitForMap(page);
    await page.evaluate(() => {
      const m = window.map.map;
      m.jumpTo({center: [m.getCenter().lng + 0.02, m.getCenter().lat + 0.02]});
    });
    await expect.poll(() => feedUrls.length, {message: 'escaping the fetched bbox should refetch'}).toBe(2);
    expect(feedUrls[1].searchParams.get('bbox')).not.toBe(feedUrls[0].searchParams.get('bbox'));
  });
});
