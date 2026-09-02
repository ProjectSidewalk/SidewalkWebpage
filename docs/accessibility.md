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
each page in `test/e2e/pages.js`, tagged `wcag2a` + `wcag2aa` + `wcag21aa`, and fails on any violation the page's
allowlist does not already track. It rides inside the existing Playwright browser suite, so it loads each page
through the same `loadAndSettle()` protocol the runtime-error gate uses — what axe measures is the same settled DOM.

```bash
make test-e2e args="--project=a11y"         # just the accessibility gate
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

**All of them, by default.** The gate reads `test/e2e/pages.js` — the one page table the browser suite shares — so
coverage is **opt-out**: add a page there and it is held to WCAG 2.1 AA from that moment, alongside the
runtime-error check. Nobody has to remember to opt a new page in, and a page cannot quietly escape the standard by
not appearing on a second list.

Getting out takes one of two deliberate acts, and the two mean different things:

- **`EXEMPT_PAGES`** (in `a11y-allowlist.js`) drops the whole page. That is a claim that we are not holding the page
  to AA yet — a big claim, so it wants a reason and a plan. It should stay empty.
- **The allowlist** forgives specific known violations on a page that is otherwise gated. Almost always the right
  tool. See below.

Registered-user and admin pages are the current gap: they need a session, so they are not in `pages.js` at all.

### Forced render states

A page walk measures whatever state the database puts a page in, which for a seeded schema is always the healthy
render. `test/e2e/a11y-api-docs-states.spec.js` covers the other one: it intercepts an api-docs preview's endpoint,
serves a truncated body or an empty result, and scans the message the preview shows instead of its chart. That
markup — small low-contrast text on a tinted ground — is where the contrast risk actually sits, and it is what a
reader meets during an API outage or on a deployment with nothing recorded yet.

One state per distinct DOM shape, not one per page: twelve previews share the same `.message-error` markup, so the
table in that file lists a page once, when it is the first to render a shape. Each case asserts the state is on
screen before axe runs — a preview that quietly recovered would otherwise be scanned as a healthy page and pass for
the wrong reason.

Allowlist keys for these carry a ` [state]` suffix (`/v3/api-docs/rawLabels [feed error]`), so an entry written for
a page's healthy render cannot silently cover its error render.

### Announcing what was injected

axe has no rule for a message nobody hears. A preview that swaps its chart for "Failed to load…" long after page
load changes nothing a screen reader announces unless the injected node says what it is, so every one of these
carries a live-region role:

- **`role="alert"`** when something failed — a feed error, a malformed response. Assertive: it interrupts.
- **`role="status"`** when nothing failed — no labels in this region, no data in this period, no contributors yet.
  Polite, because an empty result is an ordinary answer, not a fault.

The split is asserted directly in `a11y-api-docs-states.spec.js`, since no axe rule will catch its loss. Ordinary
descriptive text rendered as part of a normal result (`.preview-note` summarizing a chart) takes neither role — it
is there on load, and a live region would announce it for no reason.

### Third-party embeds

axe descends into same-page frames, so an embedded player's own chrome reports as our violations — the four YouTube
embeds on `/help` were worth 11 findings in markup we cannot touch. Those frames are **excluded** rather than
allowlisted: an allowlist entry claims a work item, and there is no work to do. `THIRD_PARTY_FRAMES` in
`a11y.spec.js` holds the selector.

Excluding the frame takes our own `<iframe>` tag out of scope with it, so the accessible name on it — the thing a
screen reader announces in place of the video — gets its own test in the same file. Add to that test if you exclude
another kind of embed.

A third-party widget rendered into **our** DOM is a different case: it *is* fixable — report it upstream, shim it,
or replace the widget — so an allowlist entry only holds the place until one of those lands. The Mapbox search box
is the worked example ([#5087](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5087)): Search JS writes
`aria-expanded` on its `role="combobox"` input only from its own show/hide-results handlers, so a box nobody had
typed into yet was missing it. Both mount sites now seed the attribute and let the component take it from there.
Note the selector they use — `input[role="combobox"]`, scoped to the element we mounted — because the component
hashes its class names and results-list id per mount (`.mbx0420900a--Input` one load, `.mbx00a6ef43--Input` the
next).

### Where it runs in CI

In the `e2e-smoke` job, as its own **blocking** step (`--project=a11y`), ahead of the runtime-error smoke suite —
also blocking since #5115. The gate is a Playwright project rather than a `--grep` so the two halves are partitioned
by which file a spec lives in, not by how its title is worded.

Gating is safe this early precisely because a page is only in the table once its violations are fixed or tracked, so
a failure is a regression against a standard we already meet. Adding a page is what takes judgment; keeping the ones
already there green is not.

One caveat on what that gate sees: CI's seed (`test/e2e/fixtures/ci-seed.sql`) puts a handful of gallery cards
and leaderboard rows on the page, not the thousands a dev DB holds. Violations that only appear at volume — a
wrapped long username, a grid that only overflows past N cards — are checked when the suite runs against a seeded
DB, not by CI, so it is still worth running both.

Note that a failing job only *blocks a merge* once the check is required in branch protection — see
[`docs/testing-and-ci.md`](testing-and-ci.md). The open data portal pages
([#5058](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5058)) join the table when they land.

### The allowlist

`test/e2e/a11y-allowlist.js` maps each page path — optionally with a ` [state]` suffix, see *Forced render
states* above — to the violations it is currently allowed to have. **It is a work
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
  `main.css` design tokens and this mostly settles itself. The trap is that a link color has a second floor: 3:1
  against the copy around it (1.4.1), since the hue is the only thing marking it. `--color-link-200` clears 4.5:1
  on every surface we put it on, but reaches only 2.4:1 against `--color-neutral-900` and 2.2:1 against
  `--color-asphalt-500`, so links inside copy in those colors need an underline.

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
