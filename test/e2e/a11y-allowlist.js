/**
 * The accessibility gate's exemptions, its per-page allowlist, and the helpers that apply them (issue #5060).
 *
 * Two different escape hatches, both deliberately awkward:
 *
 * - EXEMPT_PAGES drops a whole page out of the gate. Coverage is otherwise opt-out — every page in pages.js is
 *   gated — so this is the only way a page avoids the standard, and it needs a reason someone can argue with.
 * - A11Y_ALLOWLIST forgives specific known violations on a page that is otherwise gated. It is a work queue, not an
 *   exemption list: `issue` is required and must name a real tracked issue, so a reader can tell a
 *   known-and-scheduled failure from one nobody has looked at.
 *
 * Scope an allowlist entry as tightly as the violation allows — a bare `{rule}` silences that rule for the whole
 * page, hiding the next instance too. `selector` is matched as a substring of the node's target, so `.au-body`
 * covers `#main > .au-body`.
 *
 * Keys are page paths, optionally with a ` [state]` suffix naming a forced render state
 * (`/v3/api-docs/rawLabels [feed error]`, from a11y-api-docs-states.spec.js). A page's healthy render and its
 * error render are different DOM, so they get different keys — an entry written for one cannot quietly cover the
 * other, and neither is reported stale because the other scan didn't see it.
 */

/**
 * Pages held out of the gate entirely, keyed by path, with the reason. Empty is the goal: a page here is one we have
 * decided not to hold to WCAG 2.1 AA yet, which is a bigger claim than forgiving a violation.
 */
const EXEMPT_PAGES = {};

/**
 * The tags every axe run in this suite measures against: WCAG 2.1 AA, which subsumes 2.0 A and AA. axe's
 * `best-practice` tag is left off — useful advice, but not part of the standard we hold ourselves to, and a gate
 * that fails outside the commitment gets ignored. Shared so the page walk and the forced-state scans can't drift.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

/** Known, tracked violations keyed by page path (or `path [state]`), as `{rule, selector?, issue, note}`. */
const A11Y_ALLOWLIST = {};

/**
 * Splits a page's axe violations into what its allowlist covers and what fails the gate.
 *
 * Matching is per **node**, not per rule: if a rule fires on three elements and the allowlist names one, the other
 * two still fail. That is what keeps a scoped entry from quietly covering the next instance of the same rule.
 *
 * @param {string} path - The page path whose allowlist applies.
 * @param {Array<Object>} violations - `results.violations` from an AxeBuilder analyze().
 * @returns {{blocking: Array<Object>, allowedCount: number, staleEntries: Array<Object>}} `blocking` carries only
 *   the non-allowlisted nodes of each violation; `staleEntries` are entries no node matched — candidates for
 *   deletion.
 */
function partitionViolations(path, violations) {
  const entries = A11Y_ALLOWLIST[path] || [];
  const used = new Set();
  const covers = (entry, violation, node) => {
    if (entry.rule !== violation.id) return false;
    return !entry.selector || node.target.join(' ').includes(entry.selector);
  };
  const blocking = [];
  let allowedCount = 0;
  for (const violation of violations) {
    const remaining = [];
    for (const node of violation.nodes) {
      const entry = entries.find((e) => covers(e, violation, node));
      if (entry) {
        used.add(entry);
        allowedCount += 1;
      } else {
        remaining.push(node);
      }
    }
    if (remaining.length) blocking.push({...violation, nodes: remaining});
  }
  return {blocking, allowedCount, staleEntries: entries.filter((e) => !used.has(e))};
}

/**
 * Renders violations as one line per offending node — rule id, impact, selector, help URL: enough to reproduce and
 * fix one without opening the trace.
 *
 * @param {Array<Object>} violations - Violations to render (typically `partitionViolations`'s `blocking`).
 * @returns {string[]} One string per offending node, so a spec can assert `toEqual([])` and have the diff print the
 *   findings verbatim.
 */
function formatViolations(violations) {
  return violations.flatMap((violation) => violation.nodes.map((node) =>
    `${violation.id} [${violation.impact}] ${node.target.join(' ')} — ${violation.help} (${violation.helpUrl})`));
}

module.exports = {EXEMPT_PAGES, A11Y_ALLOWLIST, WCAG_TAGS, partitionViolations, formatViolations};
