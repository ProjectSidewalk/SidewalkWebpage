/**
 * Accessibility coverage for the api-docs previews' message states — the failure and empty renders (issue #5122).
 *
 * a11y.spec.js walks each page once, in whatever state its data puts it in — which for a seeded database is
 * always the healthy render. The degraded markup is what a real reader meets during an API outage or on a young
 * deployment with nothing recorded yet, and it is where the risk lives: small low-contrast text on a tinted
 * ground, rather than the design-system components the healthy render is built from.
 *
 * Each state is therefore forced rather than waited for. That reaches it identically on a populated dev DB and on
 * CI's seeded one, and each test names the state it measures instead of inheriting whatever the database holds.
 *
 * Two things every case asserts beyond axe:
 *
 * - **The state actually rendered.** A preview that quietly recovered would otherwise hand axe a healthy page and
 *   pass — a green run measuring nothing, which is the one way a forced-state test fails silently.
 * - **The message carries a live-region role.** These are injected into the DOM long after load, so a screen
 *   reader user is told nothing unless the injected node says it is an alert (a failure) or a status (an ordinary
 *   empty result). axe cannot see that omission — no rule fires on markup that simply never announces itself — so
 *   it is asserted directly, and it is the half of this file that catches a regression axe would sail past.
 *
 * Failures are forced as a **truncated 200** rather than a 5xx or an abort: those make Chromium log a
 * resource-load error of its own, which the console gate reads as breakage and which would drown out the one
 * console.error the preview itself is supposed to emit. A short body under a success status produces only ours —
 * and it is the honest shape anyway, since these endpoints stream their JSON.
 */
const {test, expect, loadAndSettle} = require('./fixtures');
const AxeBuilder = require('@axe-core/playwright').default;
const {PAGES} = require('./pages');
const {A11Y_ALLOWLIST, WCAG_TAGS, partitionViolations, formatViolations} = require('./a11y-allowlist');

// Valid JSON that stops early — what a client sees when a streamed response dies after its 200 has gone out.
const TRUNCATED = {status: 200, contentType: 'application/json', body: '{"features":['};

/** A complete, well-formed response body. @param {*} json - The payload to serve. @returns {object} A route fill. */
const serve = (json) => ({status: 200, contentType: 'application/json', body: JSON.stringify(json)});

/**
 * One forced state per distinct message markup, not one per page: the failure markup is shared by all twelve
 * previews that emit `.message-error`, so scanning every api-docs page in every state would pay twenty axe runs to
 * measure the same five DOM shapes. A page is listed here when it is the first to render a shape.
 *
 * `route` is the endpoint to intercept and `fulfill` what to answer with; `selector` is the message that must
 * appear before axe runs; `role` is the live-region role it must carry; `consoleError` is the one message the
 * preview is expected to log. An entry with no `consoleError` pins the other half of the contract: an empty result
 * is an ordinary answer, so the preview must render its message and log nothing.
 */
const STATES = [
  {
    state: 'feed error',
    path: '/v3/api-docs/rawLabels',
    route: '**/v3/api/rawLabels*',
    fulfill: TRUNCATED,
    selector: '.message.message-error',
    role: 'alert',
    consoleError: /Raw labels preview error/,
  },
  {
    state: 'empty region',
    path: '/v3/api-docs/rawLabels',
    route: '**/v3/api/rawLabels*',
    fulfill: serve({type: 'FeatureCollection', features: []}),
    selector: '.map-message',
    role: 'status',
  },
  {
    state: 'no contributors',
    path: '/v3/api-docs/user-stats',
    route: '**/v3/api/userStats*',
    fulfill: serve([]),
    selector: '.message.message-info',
    role: 'status',
  },
  {
    state: 'no data in period',
    path: '/v3/api-docs/overall-stats-by-day',
    route: '**/v3/api/overallStatsByDay*',
    fulfill: serve({data: []}),
    selector: '.preview-note',
    role: 'status',
  },
  {
    state: 'feed error',
    path: '/v3/api-docs/validations',
    route: '**/v3/api/validations*',
    fulfill: TRUNCATED,
    selector: '.validation-error',
    role: 'alert',
    consoleError: /Validations preview error/,
  },
  {
    state: 'feed error',
    path: '/v3/api-docs/regions',
    route: '**/v3/api/regions*',
    fulfill: TRUNCATED,
    selector: '.map-message',
    role: 'alert',
    consoleError: /Error rendering regions preview/,
  },
];

/**
 * Looks a forced state's page up in the shared table, so it loads through exactly the protocol the rest of the
 * suite uses — above all the Mapbox stub the map previews need.
 *
 * @param {string} path - The page path to find.
 * @returns {object} Its pages.js entry.
 */
function pageEntry(path) {
  const entry = PAGES.find((p) => p.path === path);
  if (!entry) throw new Error(`${path} is not in pages.js — update this spec or the table`);
  return entry;
}

for (const s of STATES) {
  const key = `${s.path} [${s.state}]`;

  test(`a11y: ${s.path} in its '${s.state}' state meets WCAG 2.1 AA`, async ({page, context, consoleErrors}) => {
    // Has to be in place before loadAndSettle navigates, since the preview fetches during init. The stubs it
    // installs afterwards match third-party hosts only, so nothing here competes with them for a request.
    await context.route(s.route, (route) => route.fulfill(s.fulfill));

    await loadAndSettle(page, context, pageEntry(s.path));

    // The state has to be on screen before axe measures anything: a preview that recovered would otherwise be
    // scanned as a healthy page and pass for the wrong reason.
    const message = page.locator(s.selector).first();
    await expect(message, `${key}: the state never rendered`).toBeVisible();

    // What axe has no rule for. The message is injected long after load, so without this it is silent.
    await expect(message, `${key}: injected message is not announced`).toHaveAttribute('role', s.role);

    // A failure is reported once, by the preview. Anything else — an unhandled rejection from the failed branch
    // above all — is a defect, and an empty state must log nothing at all.
    const unexpected = consoleErrors.filter((e) => !(s.consoleError && s.consoleError.test(e)));
    expect(unexpected, `${key}: unexpected console output`).toEqual([]);

    const results = await new AxeBuilder({page}).withTags(WCAG_TAGS).analyze();
    const {blocking, allowedCount, staleEntries} = partitionViolations(key, results.violations);

    for (const entry of staleEntries) {
      test.info().annotations.push({
        type: 'stale-a11y-allowlist',
        description: `${key}: '${entry.rule}'${entry.selector ? ` on '${entry.selector}'` : ''} no longer ` +
          `fires (${entry.issue}) — drop it from a11y-allowlist.js if ${entry.issue} is fixed`,
      });
    }

    const blockingNodes = blocking.reduce((total, violation) => total + violation.nodes.length, 0);
    expect(formatViolations(blocking),
      `${key}: ${blockingNodes} non-allowlisted WCAG 2.1 AA violation(s), ${allowedCount} allowlisted`)
      .toEqual([]);
  });
}

// A state-suffixed allowlist key outlives the state it named as easily as a page key outlives its page, and
// a11y.spec.js's key check only proves the page half of it exists.
test('a11y: state-suffixed allowlist keys name states this spec forces', () => {
  const forced = new Set(STATES.map((s) => `${s.path} [${s.state}]`));
  const unknown = Object.keys(A11Y_ALLOWLIST)
    .filter((key) => key.includes(' [') && !forced.has(key));
  expect(unknown, 'keys naming no forced state').toEqual([]);
});
