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

// Load flags mirror each page's entry in pages.spec.js.
const PAGES = [
  // Landing maps are deferred behind util.onFirstInteractionOrIdle (#4486) — without the wait, axe scans a
  // half-rendered page.
  {path: '/', mapbox: true, waitFor: (page) => page.waitForFunction(() => window.choropleth && window.deploymentMap)},
  {path: '/signIn'},
  {path: '/signUp'},
  {path: '/routes'},
  {path: '/stories'},
  {path: '/labelingGuide'},
  {path: '/gallery', loadingOverlay: true},
  {path: '/cities', mapbox: true},
  {path: '/mobileLanding'},
];

for (const p of PAGES) {
  test(`a11y: ${p.path} meets WCAG 2.1 AA`, async ({page, context}) => {
    await loadAndSettle(page, context, p);
    const results = await new AxeBuilder({page}).withTags(WCAG_TAGS).analyze();
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
