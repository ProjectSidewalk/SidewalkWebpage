# Accessibility

Project Sidewalk is a tool about physical accessibility, so the website itself has to be accessible. This page
records the target we hold ourselves to, the automated gate that enforces the mechanical half of it, and the manual
checks that cover everything a tool can't see.

Related: [`docs/testing-and-ci.md`](testing-and-ci.md) (what CI runs and what blocks a merge),
[`test/e2e/README.md`](../test/e2e/README.md) (the browser suite the gate lives in),
[`docs/style-guide.md`](style-guide.md) (the design tokens most contrast questions are settled by).

## The target

**WCAG 2.1 Level AA.** New and reworked UI should also satisfy the additions in **WCAG 2.2 AA** (notably 2.4.11
*Focus Not Obscured*, 2.5.7 *Dragging Movements*, and 2.5.8 *Target Size (Minimum)*) — 2.2 is a superset of 2.1, so
meeting it is never a conflict. The automated gate is pinned to 2.1 AA because that is what axe-core's rule tags
cover; 2.2's additions are checked by hand.

Two things this target is *not*:

- It is not a claim about the **street-view tools**. Explore and Validate are built on a mouse-driven panorama
  canvas, and making the core labeling action reachable without a mouse is open design work
  ([#4227](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4227),
  [#4233](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4233)), not a bug fix. They are held to the same
  standard as a goal and are not in the gate yet — see [Tool UIs](#tool-uis-explore-and-validate).
- It is not satisfied by a green automated run. Automated rules catch on the order of a third of WCAG failures. The
  [manual checklist](#manual-audit-checklist) is the other part of the commitment.

## The automated gate

`test/e2e/a11y.spec.js` runs [axe-core](https://github.com/dequelabs/axe-core) (via `@axe-core/playwright`) against
each page in its own table, tagged `wcag2a` + `wcag2aa` + `wcag21aa`, and fails on any violation the page's allowlist
does not already track. It rides inside the existing Playwright browser suite, so it loads each page through the same
`loadAndSettle()` protocol the runtime-error gate uses — what axe measures is the same settled DOM.

```bash
make test-e2e args="-g a11y --no-deps"      # just the accessibility gate
make test-e2e                               # the whole browser suite, gate included
```

A failure prints one line per offending element — rule id, impact, selector, and the Deque help URL:

```
color-contrast [serious] .some-banner-link — Elements must meet minimum color contrast ratio
  thresholds (https://dequeuniversity.com/rules/axe/4.13/color-contrast)
```

axe's `best-practice` tag is deliberately **not** enabled. Those rules are good advice but are not part of WCAG, and
a gate that fails for things outside the commitment gets ignored.

### Which pages are in the gate

`a11y.spec.js` keeps its own page table rather than sharing `pages.spec.js`'s. A page joins the table once its
violations are either fixed or tracked, so **a page missing from the table is a page nobody has audited yet** —
which is information worth being able to read off the file. Pages are added as the
[`Website Accessibility`](https://github.com/ProjectSidewalk/SidewalkWebpage/labels/Website%20Accessibility) backlog
closes.

### Where it runs in CI

In the existing `e2e-smoke` job, which is **advisory** today — findings report but don't block a merge. It becomes
blocking for the open data portal pages ([#5058](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5058))
and the `/api` docs pages once those pages are clean, and the blocking set grows from there
([#5060](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5060)).

### The allowlist

`test/e2e/a11y-allowlist.js` maps each page path to the violations it is currently allowed to have. **It is a work
queue, not an exemption list.** Every entry needs:

- `rule` — the axe rule id (`color-contrast`, `link-name`, `region`, …).
- `selector` — optional, but use it. It is matched as a substring of the node's target, so `.au-body` covers
  `#main > .au-body`. Without it the rule is silenced for the *whole page*, which hides the next instance too.
- `issue` — **required**, and it must point at a real tracked issue. An entry with no issue behind it is a bug in
  the file.
- `note` — what the violation actually is, so a reader can tell a known-and-scheduled failure from one nobody has
  looked at.

```js
{rule: 'color-contrast', selector: '.some-banner-link', issue: '#1234',
  note: 'link blue on the amber band is 3.98:1; the token is tuned for white and fails on any tint'},
```

Matching is **per element**, not per rule: if a rule fires on three elements and the allowlist names one, the other
two still fail. Entries that no longer match anything are reported as a `stale-a11y-allowlist` annotation rather than
a failure (a violation can stop firing because it was fixed *or* because the page rendered differently that run) —
when you fix an issue, delete its entry.

**Adding an entry is a last resort.** Fix the violation if you can; most are a token swap or a missing
`aria-label`. File an issue and allowlist it only when the fix is a real design decision.

## Manual audit checklist

Run this against any page you substantially change, and against the whole set periodically.

**Keyboard only** (unplug the mouse):

- Every interactive control is reachable with <kbd>Tab</kbd> and operable with <kbd>Enter</kbd>/<kbd>Space</kbd>.
- The focus indicator is always visible and never clipped or covered by sticky chrome (WCAG 2.4.11).
- Tab order follows the visual order; nothing traps focus except a modal, which must trap it *and* release it on
  <kbd>Esc</kbd>.
- A skip-to-content link is the first stop
  ([#4236](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4236)).

**Screen reader** — test on at least one of each engine, since they diverge:

- Windows: **NVDA** + Firefox or Chrome.
- macOS: **VoiceOver** + Safari.
- Walk the page by heading (`H`) and by landmark (`D`/rotor): the heading levels descend without gaps, and the
  page has `main`, `nav`, and `footer` landmarks.
- Every control announces a name, a role, and its state. Dynamic updates (a validation result, a toast, a loaded
  section) are announced via a live region ([#4235](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4235)).
- Images carry meaningful `alt` text, and decorative ones carry `alt=""` or `aria-hidden="true"`.

**Zoom and reflow:**

- 200% browser zoom, and 400% at a 1280px viewport (WCAG 1.4.10): no content or function is lost, and nothing needs
  horizontal scrolling except a sanctioned wide-content scroller (a table, a code block).
- 390px-wide phone viewport: no horizontal overflow. This half is automated —
  `test/e2e/phone-viewport.spec.js` ([#4883](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4883)).

**Motion and color:**

- With `prefers-reduced-motion: reduce` set, non-essential animation stops.
- No information is carried by color alone — a severity, a status, or a label type needs a shape, an icon, or text
  too.
- Text contrast: 4.5:1 for body text, 3:1 for large text and for UI component boundaries. Style from the
  `main.css` design tokens and this mostly settles itself; the trap is a token validated on white being reused on a
  tinted surface. `--color-link-200` in particular sits at exactly 4.5:1 on white, so it fails on any tint.

**Forms:**

- Every input has a visible, programmatically associated `<label>` (not just a placeholder).
- Errors are announced, name the field, and say how to fix it.

## Tool UIs (Explore and Validate)

The content pages and the tool pages are held to the same standard but handled differently.

Explore and Validate center on a street-view panorama the user labels by clicking, and much of their chrome is
non-semantic `div`s from the pre-2024 codebase. Bringing them to AA is a sequence of design questions — what a
keyboard path to "place a label at this point in the image" even looks like — tracked as
[#4227](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4227),
[#4233](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4233),
[#4234](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4234),
[#4235](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4235), and
[#4843](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4843).

So they are **not in the automated gate yet**: a page whose allowlist would be longer than its violation list
teaches nobody anything, and a gate that is red by design gets muted. They join once the backlog above has closed
enough that an allowlist is a work queue rather than a snapshot. In the meantime they are covered by the manual
checklist and by the IRB-approved usability studies, which is where screen-reader users evaluate the real task
rather than the markup.

When you touch tool UI in the meantime, the going-forward rule is the ordinary one: new controls are real semantic
elements (`<button>`, `<a>`, `<input>`) with names and keyboard handlers, never a `div` with a click listener.

## Reporting a problem

Open an issue with the **`Website Accessibility`** label. Include the page, the assistive technology and browser (with
versions), what you expected, and what happened. If axe found it, paste its line — the rule id and selector are
usually enough to reproduce.
