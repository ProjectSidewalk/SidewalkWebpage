/**
 * Accessibility gate (issue #5060): axe-core over every page the browser suite covers, failing on any WCAG 2.1 AA
 * violation that a11y-allowlist.js does not already track.
 *
 * This is the mechanical half of WCAG only — a green run is not a claim of conformance, just that nothing
 * mechanically detectable regressed. The manual half is the checklist in docs/accessibility.md.
 *
 * The page list is pages.js, shared with the smoke suite, so coverage here is **opt-out**: a page added there is
 * gated by default and stays gated unless someone writes it into EXEMPT_PAGES with a reason. Loading goes through
 * `loadAndSettle`, so what axe measures is the same settled DOM the error gate measures.
 *
 * Coverage follows the data: CI's seed puts a few cards on /gallery and a few rows on /leaderboard where a dev DB
 * puts thousands, so what only volume brings out (a wrapped long username, a grid that overflows past N cards) is
 * visible locally and not in CI.
 */
const {test, expect, loadAndSettle} = require('./fixtures');
const AxeBuilder = require('@axe-core/playwright').default;
const {PAGES} = require('./pages');
const {EXEMPT_PAGES, A11Y_ALLOWLIST, WCAG_TAGS, STATE_SUFFIX, partitionViolations, formatViolations} =
  require('./a11y-allowlist');

// axe descends into same-page frames, so a vendor's player chrome reports as our violations (/help embeds four
// YouTube players, worth 11 between them) — none of it markup we can change. axe's frame-path exclude syntax
// (`['iframe…', ':root']`) does not reach these: @axe-core/playwright injects into each frame itself rather than
// through axe's own frame messaging, so the path never resolves. Excluding the element is what works, and it takes
// our own <iframe> tag out of scope too — the accessible name that costs us is asserted by its own test below.
const THIRD_PARTY_FRAMES = 'iframe[src*="youtube.com"]';

const GATED_PAGES = PAGES.filter((p) => !(p.path in EXEMPT_PAGES));

for (const p of GATED_PAGES) {
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

    // axe gives one entry per rule, so count nodes — that matches the lines printed below and `allowedCount`.
    const blockingNodes = blocking.reduce((total, violation) => total + violation.nodes.length, 0);
    expect(formatViolations(blocking),
      `${p.path}: ${blockingNodes} non-allowlisted WCAG 2.1 AA violation(s), ${allowedCount} allowlisted`)
      .toEqual([]);
  });
}

// A key matching no page is silent — an exemption typo stops exempting, a real key outlives the page it named — and
// the stale-entry annotation above can't catch either, since it only runs for pages still in the table.
test('a11y: allowlist and exemption keys name pages that exist', () => {
  const paths = new Set(PAGES.map((p) => p.path));
  // An allowlist key may carry a ` [state]` suffix naming a forced render state (a11y-allowlist.js); the page it
  // names still has to exist, which is what this checks.
  const unknown = [...Object.keys(EXEMPT_PAGES), ...Object.keys(A11Y_ALLOWLIST)]
    .filter((key) => !paths.has(key.replace(STATE_SUFFIX, '')));
  expect(unknown, 'keys not present in pages.js').toEqual([]);
});

// Exemption is looked up by bare path, so a suffixed key would exempt nothing while both key tests stayed green.
test('a11y: exemption keys are bare page paths', () => {
  const suffixed = Object.keys(EXEMPT_PAGES).filter((key) => STATE_SUFFIX.test(key));
  expect(suffixed, 'EXEMPT_PAGES keys cannot name a single state').toEqual([]);
});

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
