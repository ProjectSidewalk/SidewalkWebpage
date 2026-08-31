/**
 * The accessibility gate's per-page allowlist and the helpers that apply it (issue #5060).
 *
 * The allowlist is a work queue, not an exemption list: `issue` is required and must name a real tracked issue, so a
 * reader can tell a known-and-scheduled failure from one nobody has looked at. The Year 1 target (#5053) is an empty
 * list for the homepage and the `/api` docs pages.
 *
 * Scope an entry as tightly as the violation allows — a bare `{rule}` silences that rule for the whole page, hiding
 * the next instance too. `selector` is matched as a substring of the node's target, so `.au-body` covers
 * `#main > .au-body`.
 */

/** Known, tracked violations keyed by page path, as `{rule, selector?, issue, note}`. */
const A11Y_ALLOWLIST = {
  '/': [
    // Site-wide chrome, so it reappears on every page added to the table until the token question is settled.
    {rule: 'color-contrast', selector: '.test-server-banner-link', issue: '#5079',
      note: 'link blue on the amber band is 3.98:1; the token is tuned for white and fails on any tint'},
  ],
};

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

module.exports = {A11Y_ALLOWLIST, partitionViolations, formatViolations};
