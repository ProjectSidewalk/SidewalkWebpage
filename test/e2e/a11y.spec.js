/**
 * Accessibility gate (issue #5060): axe-core over each audited page, failing on any WCAG 2.1 AA violation that
 * a11y-allowlist.js does not already track.
 *
 * This is the mechanical half of WCAG only — a green run is not a claim of conformance, just that nothing
 * mechanically detectable regressed. The manual half is the checklist in docs/accessibility.md.
 *
 * The page table is a separate list from pages.spec.js's rather than a shared one: pages join this gate as their
 * violations are fixed, so a page not listed here is a page nobody has audited yet. Loading goes through the smoke
 * suite's `loadAndSettle`, so what axe measures is the same settled DOM the error gate measures.
 */
const {test, expect, loadAndSettle} = require('./fixtures');
const AxeBuilder = require('@axe-core/playwright').default;
const {partitionViolations, formatViolations} = require('./a11y-allowlist');

// WCAG 2.1 AA, which subsumes 2.0 A and AA. axe's `best-practice` tag is left off: useful advice, but not part of
// the standard we hold ourselves to, and a gate that fails outside the commitment gets ignored.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

// axe descends into same-page frames, so a vendor's player chrome reports as our violations (/help embeds four
// YouTube players, worth 11 between them) — none of it markup we can change. axe's frame-path exclude syntax
// (`['iframe…', ':root']`) does not reach these: @axe-core/playwright injects into each frame itself rather than
// through axe's own frame messaging, so the path never resolves. Excluding the element is what works, and it takes
// our own <iframe> tag out of scope too — the accessible name that costs us is asserted by its own test below.
const THIRD_PARTY_FRAMES = 'iframe[src*="youtube.com"]';

// Load flags mirror each page's entry in pages.spec.js.
const PAGES = [
  // Landing maps are deferred behind util.onFirstInteractionOrIdle (#4486) — without the wait, axe scans a
  // half-rendered page.
  {path: '/', mapbox: true, waitFor: (page) => page.waitForFunction(() => window.choropleth && window.deploymentMap)},
  {path: '/signIn'},
  {path: '/signUp'},
  {path: '/about', makeabilityLab: true, mapbox: true},
  {path: '/leaderboard'},
  {path: '/routes'},
  {path: '/stories'},
  {path: '/labelingGuide'},
  {path: '/help'},
  // Every /v3/api-docs page (#5060's Year 1 target is an empty allowlist across the whole reference).
  {path: '/api'},
  {path: '/v3/api-docs'},
  {path: '/v3/api-docs/labelTypes'},
  {path: '/v3/api-docs/cities'},
  {path: '/v3/api-docs/labelTags'},
  {path: '/v3/api-docs/rawLabels'},
  {path: '/v3/api-docs/labelClusters'},
  {path: '/v3/api-docs/streets'},
  {path: '/v3/api-docs/streetTypes'},
  {path: '/v3/api-docs/regions'},
  {path: '/v3/api-docs/accessScoreStreets'},
  {path: '/v3/api-docs/accessScoreRegions'},
  {path: '/v3/api-docs/validations'},
  {path: '/v3/api-docs/validation-result-types'},
  {path: '/v3/api-docs/labelEdits'},
  {path: '/v3/api-docs/user-stats'},
  {path: '/v3/api-docs/overall-stats'},
  {path: '/v3/api-docs/overall-stats-by-day'},
  {path: '/v3/api-docs/aggregate-stats'},
  {path: '/v3/api-docs/aggregate-stats-by-day'},
  {path: '/gallery', loadingOverlay: true},
  {path: '/labelMap', mapbox: true, loadingOverlay: true},
  {path: '/routeBuilder', mapbox: true},
  {path: '/cities', mapbox: true},
  {path: '/mobileLanding'},
];

for (const p of PAGES) {
  test(`a11y: ${p.path} meets WCAG 2.1 AA`, async ({page, context}) => {
    await loadAndSettle(page, context, p);
    const results = await new AxeBuilder({page})
      .withTags(WCAG_TAGS)
      .exclude(THIRD_PARTY_FRAMES)
      .analyze();
    const {blocking, allowedCount, staleEntries} = partitionViolations(p.path, results.violations);

    // Report rather than fail: a violation can stop firing because it was fixed or because the page rendered
    // differently this run, and failing for the first would punish the fix. An annotation rides the HTML report.
    for (const entry of staleEntries) {
      test.info().annotations.push({
        type: 'stale-a11y-allowlist',
        description: `${p.path}: '${entry.rule}'${entry.selector ? ` on '${entry.selector}'` : ''} no longer ` +
          `fires (${entry.issue}) — drop it from a11y-allowlist.js if ${entry.issue} is fixed`,
      });
    }

    expect(formatViolations(blocking),
      `${p.path}: ${blocking.length} non-allowlisted WCAG 2.1 AA violation(s), ${allowedCount} allowlisted`)
      .toEqual([]);
  });
}

// Stands in for the frame-title check the exclusion above removes. Nothing inside a YouTube player is ours, but the
// name on the <iframe> is the whole reason a screen reader user knows which video they landed in — it is announced
// in place of the frame's contents, and there is no other coverage of it.
test('a11y: embedded video frames carry an accessible name', async ({page, context}) => {
  await loadAndSettle(page, context, {path: '/help'});
  const frames = page.locator(THIRD_PARTY_FRAMES);
  expect(await frames.count(), '/help no longer embeds video; drop this test').toBeGreaterThan(0);
  const unnamed = await frames.evaluateAll((els) => els
    .filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('title') || '').trim())
    .map((el) => el.src));
  expect(unnamed, 'embedded videos with no aria-label or title').toEqual([]);
});
