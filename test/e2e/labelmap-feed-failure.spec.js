/**
 * Behavior tests for how /labelMap reacts when its label feed fails (#3932).
 *
 * `/labels/all` is streamed from the database as a chunked 200, so the status and headers are committed
 * before a single row is read. A failure mid-stream therefore arrives as a *truncated body under a success
 * status* — no status check can catch it, and the JSON parse is the only thing that throws. That mode can't
 * be provoked from the server, so intercepting the response in the browser is the only way to exercise it.
 *
 * Wider than the rest of this suite, which only asserts that pages initialize cleanly: these drive a real
 * failure and assert what the user is shown. Kept to DOM state (which card is visible, is retry focused) —
 * canvas and imagery testing stays manual, per the suite's charter.
 *
 * Every case intercepts the feed, so none of them read the database: they behave identically against a
 * seeded dev schema and CI's empty one.
 *
 * /admin/label-map renders the same overlay through the same MapLoadingOverlay class, so these cover its
 * behavior too — it isn't driven directly here because reaching it needs an admin session, which the suite's
 * setup (a throwaway *registered* user) doesn't mint.
 */
const {test, expect, stubMapbox, waitForAppReady} = require('./fixtures');

// A valid GeoJSON prefix that simply stops — what a client sees when the database stream dies after the 200
// has gone out. Status and Content-Type both still say success.
const TRUNCATED_FEED = '{"type":"FeatureCollection","features":[{"type":"Feature","geometry":';

// The zero-row response, a legitimate answer (a filter matching nothing) that must not read as a failure.
const EMPTY_FEED = '{"type":"FeatureCollection","features":[]}';

/** Routes the label feed through `handler`, matching the query string the page appends. */
async function routeLabelFeed(context, handler) {
  await context.route('**/labels/all*', handler);
}

/** Loads /labelMap and waits for the shared init manager, whatever the feed did. */
async function openLabelMap(page) {
  const response = await page.goto('/labelMap');
  expect(response.status(), `/labelMap responded ${response.status()}`).toBeLessThan(400);
  await waitForAppReady(page);
}

/** Fulfills with a complete, well-formed body. */
const serveEmptyFeed = (route) =>
  route.fulfill({status: 200, contentType: 'application/json', body: EMPTY_FEED});

test.describe('/labelMap label feed failure', () => {
  test('shows a retryable error when the feed cannot be reached', async ({page, context}) => {
    await stubMapbox(context);
    await routeLabelFeed(context, (route) => route.abort('failed'));

    await openLabelMap(page);

    await expect(page.locator('#labelmap-error-card')).toBeVisible();
    await expect(page.locator('#labelmap-loading-card')).toBeHidden();
    // Keyboard users land on the only available action rather than having to hunt for it.
    await expect(page.locator('#labelmap-retry')).toBeFocused();
  });

  // The regression this file exists for: a 200 whose body stops early still has to reach the user as an error.
  test('shows the error when the streamed body is truncated under a 200', async ({page, context}) => {
    await stubMapbox(context);
    await routeLabelFeed(context, (route) =>
      route.fulfill({status: 200, contentType: 'application/json', body: TRUNCATED_FEED}));

    await openLabelMap(page);

    await expect(page.locator('#labelmap-error-card')).toBeVisible();
    await expect(page.locator('#labelmap-loading-card')).toBeHidden();
  });

  // Truncation rather than abort: an aborted request also emits Chromium's own resource-load error, which
  // would drown out the signal here. A 200 with a short body produces only the failure the page itself reports.
  test('a failed feed leaves no uncaught errors behind', async ({page, context, consoleErrors}) => {
    await stubMapbox(context);
    await routeLabelFeed(context, (route) =>
      route.fulfill({status: 200, contentType: 'application/json', body: TRUNCATED_FEED}));

    await openLabelMap(page);
    await expect(page.locator('#labelmap-error-card')).toBeVisible();
    await page.waitForTimeout(1000); // Settle window: a late unhandled rejection would land here.

    // The page reports the failure itself, so exactly one handled console.error is expected. Anything else —
    // above all a `pageerror` or an "Uncaught (in promise)" from a dangling promise branch — is a defect.
    expect(consoleErrors.filter((e) => !e.includes('LabelMap failed to load'))).toEqual([]);
  });

  test('retry reloads the page and recovers once the feed answers', async ({page, context}) => {
    await stubMapbox(context);
    let attempts = 0;
    await routeLabelFeed(context, (route) => {
      attempts += 1;
      return attempts === 1 ? route.abort('failed') : serveEmptyFeed(route);
    });

    await openLabelMap(page);
    await expect(page.locator('#labelmap-error-card')).toBeVisible();

    // Marker on the current document: a reload replaces it, so its disappearance is proof of a real
    // navigation. Waiting on the URL wouldn't work — it never changes, so the wait resolves instantly.
    await page.evaluate(() => { window.__beforeRetry = true; });
    await page.locator('#labelmap-retry').click();
    await page.waitForFunction(() => !window.__beforeRetry);

    await waitForAppReady(page);
    await page.locator('#labelmap-loading').waitFor({state: 'hidden'});
    await expect(page.locator('#labelmap-error-card')).toBeHidden();
    expect(attempts, 'retry should have re-requested the feed').toBeGreaterThan(1);
  });

  test('an empty feed is a normal result, not an error', async ({page, context, consoleErrors}) => {
    await stubMapbox(context);
    await routeLabelFeed(context, serveEmptyFeed);

    await openLabelMap(page);
    await page.locator('#page-loading').waitFor({state: 'hidden'});
    await page.waitForTimeout(1000);

    await expect(page.locator('#labelmap-error-card')).toBeHidden();
    expect(consoleErrors).toEqual([]);
  });
});
