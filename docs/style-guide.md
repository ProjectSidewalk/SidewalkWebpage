# Code style guide

This is the detailed style reference for Project Sidewalk. [`CONTRIBUTING.md`](../CONTRIBUTING.md) lists the
day-to-day essentials and links here for the full conventions; [`CLAUDE.md`](../CLAUDE.md) holds the architecture and
the ScalaDoc/JSDoc comment standards. This page explains the conventions a linter can't, and the *why* behind the
ones it can.

**The linters are the source of truth for mechanically-checkable rules.** JavaScript/CSS/HTML rules live in
[`eslint.config.js`](../eslint.config.js), [`stylelint.config.mjs`](../stylelint.config.mjs), and
[`.htmlhintrc`](../.htmlhintrc); Scala formatting lives in [`.scalafmt.conf`](../.scalafmt.conf). When this guide and a
config disagree, the config wins — fix the config and this doc together. **The linters are all blocking CI gates** —
ESLint (JS + translation JSON), Stylelint (CSS), HTMLHint (HTML), cross-locale key parity, the `public/css/` layout
check, the `public/js/` asset-path check, and `scalafmtCheckAll` for Scala. The trees are kept fully lint-clean
([#2487](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2487)), so run the relevant linter — or `make lint`
for all of them — and get to zero before you push: `make lint-fix` autofixes the mechanical JS/CSS findings, hand-fix
the rest. CI wiring is in [`docs/testing-and-ci.md`](testing-and-ci.md).

## General

These apply across every language in the repo.

- **Line length: 120 characters max**, with sensible exceptions where a break would hurt readability (e.g. long
  URLs, string literals). For multi-line comments, treat 120 as a target, not a hard cap.
- **Indent with spaces, never tabs.** Scala, JS, and CSS all use 2-space indent.
- **End every file with a single newline.** A missing final newline shows up as a red marker on the GitHub diff.
- **Comments explain _why_, not _what_** — well-named identifiers cover the *what*. Start a comment with a capital
  letter and end it with a period:

  ```js
  // This is the correct style.
  //this is incorrect
  ```

- **Accessibility is part of style.** Any UI work must meet **WCAG 2.1/2.2 Level AA**.
- **Style from the design-system tokens in `main.css` `:root`.** Colors (`--color-*`), type (`--text-*`), spacing
  (`--space-*`), radii (`--border-radius*`), elevation (`--box-shadow*`), motion (`--transition-*`), stacking
  (`--z-index-*`), breakpoints (`--breakpoint-*` — reference values, since `var()` can't appear in a media query;
  write the px and name the token in a comment) and button styles come from our Figma "Design System Tokens";
  hardcoded values are what we're migrating away from. For type, use the composite `--text-*` tokens
  (`font: var(--text-body-regular);`) rather than building on the raw `--font-primary`/`--font-accent` stacks —
  they're complete `font` shorthands (weight, size/line-height, family) and bake in `--ui-scale`. If a token's
  line-height (or another single aspect) doesn't suit, keep the token and override that one property on the next
  line instead of hand-assembling the font. Long-form reading text takes `--text-prose-regular` (body size, looser
  leading); code blocks take `--text-code-regular`.
- **Use the component primitives in `main.css` before writing a new one.** Buttons are `.button-ps` with a
  `.button--<variant>` and `.button--<size>` modifier; text inputs and textareas are `.ps-input`, `<select>`s are
  `.ps-select` (both take `--large` for a settings-style form); data tables are `.ps-table` (`--compact` for dense
  admin data, `.num` on a numeric cell, `.ps-table-wrapper` for the horizontal scroller). A page-scoped class on top
  for layout (width, margin, a sticky header, a row-highlight state) is fine; re-declaring the font, border, padding,
  or hover/focus treatment is not — extend the primitive in `main.css` instead.
- **Size in px, never `rem`.** Bootstrap 3 sets `html { font-size: 62.5% }`, so `1rem` is 10px everywhere and a
  `0.875rem` "14px" renders at 8.75px. The `--text-*` tokens are px for this reason.
- **Raleway (`--font-accent`) is display-only — and never for numbers.** Default to the primary font (Mulish); the
  accent font appears only in the tokens that already carry it (`--text-h1-bold`, `--text-h2-bold`,
  `--text-small-accent`). Raleway defaults to old-style (text) figures — digits vary in height and 3/4/5/7/9 descend
  below the baseline — so any text containing digits (counts, timers, stats, dates) must use a primary-font token.
- **Write descriptive commit messages** that say what actually changed and why. `Fixes #880`, `Addresses PR
  feedback`, and `Update ModalMissionComplete.js` are all too vague to be useful in `git log` later.

## JavaScript

The frontend is vanilla ES, organized as independent apps that Grunt concatenates (no transpiler, no module system).
Edit files under `src/`; never edit the generated `build/` bundles. Most rules below are enforced by
[`eslint.config.js`](../eslint.config.js).

- **Write ES2022 for new and modernized code:** `const`/`let` (`no-var`), arrow functions, template literals
  (`prefer-template`), object shorthand, and `===`/`!==` (`eqeqeq`). When you're editing a file that is *entirely*
  ES5, you may match its style for consistency — but prefer modernizing it. See the migration guidance in
  [`CLAUDE.md`](../CLAUDE.md) (constructor-functions → `class` with `#private` fields; jQuery → native `fetch`;
  Bootstrap → native JS/CSS as you touch that code).
- **One declaration per statement** (`one-var: never`) — the opposite of the old comma-chained `var` style:

  ```js
  const width = 640;
  const height = 480;
  ```

- **Single quotes** for string literals (`quotes: single`); use backticks when you need interpolation or multi-line
  strings.
- **Build HTML strings with template literals, never `+` concatenation.** Indent the markup inside the backticks to
  mirror its HTML nesting — ESLint deliberately doesn't reformat template-literal interiors, so the structure stays
  readable:

  ```js
  el.innerHTML = `
      <div class="card">
          <span class="card-title">${title}</span>
      </div>`;
  ```

  Two things to keep in mind:
  - The newlines/indentation become part of the string. That's fine between elements in block/flex/grid containers
    and in collapsible inline text, but when converting an old concatenation, check the target container's CSS — a
    plain inline container would gain a visible space between elements. And never break a line *inside* an attribute
    value: a newline in `title="..."` renders literally in the tooltip.
  - `eslint --fix` can't do this conversion for you (`prefer-template` only fires when a variable is involved, not on
    literal-plus-literal chains), so convert concatenated HTML by hand as you touch it.
- **Semicolons required** (`semi`); always parenthesize arrow-function params (`arrow-parens`).
- **No space between a function name and its `(`**; **do** put a space before a block's `{` and around operators and
  keywords (`if`, `for`). Blank line before and after function declarations (`padding-line-between-statements`).

  ```js
  function doSomething(param) {
      if (param === 'firstOption') {
          doSomethingElse();
      } else {
          doSomethingElseElse();
      }
  }
  ```

- **Document with JSDoc** (`/** ... */`) on every `class` and non-trivial method, including `#private` ones — type
  annotations matter because there's no static checker. Full template and rules in [`CLAUDE.md`](../CLAUDE.md).

## HTML / CSS

- **Style in CSS files, not inline** on elements. The exception is styling that genuinely has to be computed at
  runtime in JavaScript.
- **HTML attributes: no spaces around `=`** (`attr="value"`, not `attr = "value"`) — the one place we *don't* space
  around `=`. Lowercase tags and attributes, double-quoted attribute values, `alt` text on images
  ([`.htmlhintrc`](../.htmlhintrc)).
- **Prefer `data-i18n="ns:key"`** in HTML over hardcoded strings so translations stay in i18next and aren't
  duplicated (see [`CONTRIBUTING.md`](../CONTRIBUTING.md) → Internationalization).
- **CSS:** 2-space indent, `stylelint-config-standard` ([`stylelint.config.mjs`](../stylelint.config.mjs)). Use the
  `main.css` `:root` design tokens for colors/fonts/spacing.
- **Scale tool UI with `var(--ui-scale)`.** The Explore/Validate tools and the overlays layered over them are zoomed
  uniformly to fit the viewport (`util.applyToolScale` sets `--ui-scale` on `.tool-ui` and the document root). Author
  every fixed dimension for that UI as `calc(<base>px * var(--ui-scale, 1))` (paddings, gaps, sizes, borders, radii,
  and any raw `font-size`); prefer the `--text-*` type tokens, which already include it. A bare `px` there won't scale.
  Fixed page chrome (e.g. the navbar) stays unscaled on purpose.

## Frontend file & directory organization

The `public/` static-asset tree follows an industry-standard layout, settled in the #2292 reorg. Keep new files
consistent with it.

- **First-party assets split by type.** `public/js/` is **JavaScript only** — no `css/`, `img/`, or `audio/` dirs
  nested inside an app dir. Styles live in `public/css/`; media lives in `public/images/`, `public/audio/`, and
  `public/videos/`. App-private styles go to `css/pages/`, app-private images to `images/<app>/`.
- **`public/css/` is organized by what each file is** (#5030), and its root has exactly four entries. `main.css` and
  `fonts.css` (tokens and `.ps-*` primitives, no layout knowledge). `css/components/` holds anything more than one
  page links, one component per file with a `ps-` or component-named class prefix (`page-shell.css` — the sidebar +
  content + TOC template the API docs and both dashboards build on, `kpi.css`, `tables.css`, `label-detail.css`,
  `toast.css`, …). `css/pages/` holds everything page-specific: a single file for a single page (`about.css`,
  `auth.css`, `admin-dashboard.css`, `user-dashboard.css`, …) and a subdir for a page family with several files
  (`pages/explore/`, `pages/validate/`, `pages/gallery/`, `pages/api-docs/`). Two rules keep the split honest, both
  enforced by `make lint-css-layout` (`tools/check-css-layout.mjs`, a blocking CI step): every entry under `pages/`
  is registered in the lint's `PAGES` map with the views that may link it — its own page, or for the Grunt-bundled
  tools its own bundle (the two legacy exceptions, `homepage.css` and `auth.css`, are registered to the site-wide
  layout) — and an unregistered file fails the lint, so when a second page needs a rule, it moves to
  `css/components/`; and a page's class prefix (`ud-`, `ac-`/`ov-`/`dq-`/…, `svl-`, `svv-`, `gallery-`) is defined
  only in that page's stylesheet(s). Layouts link the shell plus only the component files their pages use;
  never `@import` (Play fingerprints per file, and an import adds a serial round trip).
- **Third-party code groups by library** under `public/vendor/<lib>/`, each folder self-contained (its JS + CSS +
  fonts + images together, upstream internal layout preserved so relative `url()` refs keep working). **Nothing under
  `vendor/` is ever edited or linted.** Vendored filenames carry their version (`pannellum-2.5.7.js`), which names
  in the URL what a reader would otherwise have to diff for, and keeps two versions installable side by side during
  an upgrade (see [`docs/upgrading-libraries.md`](upgrading-libraries.md)).
- **Never hardcode an `/assets/...` URL in JavaScript** (#4893). Name the asset by its logical path under `public/`
  and resolve it with **`util.assetPath('images/icons/openhand.cur')`** (defined in `public/js/common/utilities.js`,
  loaded on every page). Staged builds content-fingerprint assets and serve the fingerprinted copy `immutable` for a
  year; a hardcoded path gets the one-hour default, so a returning visitor re-asks about every asset once an hour and
  a swapped file reaches a cached client only after that hour. Twirl's equivalent is `assets.path(...)` — also
  mandatory, for the same reason. `make lint-asset-paths` enforces this; the full mechanism is in
  [`docs/deployment-and-stages.md`](deployment-and-stages.md) → "Asset caching".

**Naming conventions:**

- **Directories → kebab-case**, always (`user-dashboard/`, `ps-map/`, `label-detail/`).
- **CSS files → kebab-case**, always (`labeling-guide.css`, `user-dashboard.css`, `filter-sidebar.css`).
- **JS files → Airbnb "filename matches what it defines":** **PascalCase** for a file that defines a
  class/constructor (`AppManager.js`, `LabelPopup.js`, `GsvViewer.js`), **camelCase** for a function/utility/entry
  file (`main.js`, `aggregateStats.js`, `timestampLocalization.js`). Kebab-case is **not** used for JS files.
- **HTML `id`/`class` values → kebab-case** (`page-loading`, `severity-button`, `nav-user-menu`), with two deliberate
  exceptions:
  - **BEM** element/modifier syntax is allowed — `__` for elements, `--` for modifiers
    (`severity-button__icon`, `label-detail__col--severity`, `ps-progress-bar__fill--segmented`).
  - **`id`/`class` values that embed a backend-sourced domain value keep the backend spelling.** Label types are
    PascalCase (`label-count-CurbRamp-today`, matching the `LabelType` enum, the icon filenames, and
    `/v3/api/labelTypes`); stat/filter keys are snake_case
    (`user-count-explore-all-all_time-no_task_constraint-any_quality`). JS builds and queries these ids by
    concatenating those backend values, so kebab-casing them would break the lookups and drift from the source of
    truth (see the "backend is the source of truth" rule in [`CLAUDE.md`](../CLAUDE.md)).

  Because of those two exceptions, the htmlhint `id-class-value` rule is left **off** — its `dash` mode enforces strict
  kebab-case and can express neither BEM nor the backend-sourced values, so it can't be brought to zero. New markup
  should still default to kebab-case.

**Icons.** SVG icons live as **their own files** in `public/images/icons/` — **never inlined** in Twirl templates
(inlined SVGs are hard to find, reuse, and review — see #4058). Reference them with an `<img>`, e.g.
`<img src='@assets.path("images/icons/map-pin-feather.svg")' alt="">` (empty `alt` when the icon sits next to a text
label). Default to icons from the **feather** and **material** sets in the "Design System Tokens" Figma, and name each
file `<icon>-<set>.svg` (`map-pin-feather.svg`, `comment-material.svg`). These SVGs carry a **fixed** stroke color
(`#242424` for the standard dark icon), so a different color is a **separate file** with a color qualifier
(`chevron-left-white-feather.svg`) rather than a CSS override.

**Deferred namespace mismatch:** the reorg renamed the app *directories* (`SVLabel → explore`, `SVValidate →
validate`, `Progress → user-dashboard`), but the apps' internal JS namespace **globals** `svl` (Explore) and `sg`
(Gallery) are identifiers, not filenames, and were intentionally left as-is — renaming them is a large independent
refactor touching nearly every source line of those apps. Don't "fix" the mismatch as a drive-by.

## Scala

Formatting is handled by **scalafmt** ([`.scalafmt.conf`](../.scalafmt.conf)) — run it before pushing (`scalafmtCheckAll`
is a blocking CI gate). Conventions scalafmt doesn't cover:

- **Follow the request flow** `routes → Controller → Service → Table (DAO)`; keep controllers thin and put business
  logic in services. (See [`CLAUDE.md`](../CLAUDE.md) / [`docs/architecture.md`](architecture.md).)
- **Declare value types where it aids clarity** — prefer `val x: Int = 5` over `val x = 5`. Use discretion when the
  type is long/uninformative (often the case with Slick types) or when an explicit annotation would push a line past
  120 chars or hurt readability.
- **Use Slick for database access**, not raw SQL, wherever possible — you get compile-time type checking. When you
  must write SQL, **avoid table aliases**.
- **Measure geographic distances geodesically** — `ST_Length(geom::geography)` in raw SQL, the `lengthGeodesic`
  extension method in Slick, turf.js on the frontend. Never measure by projecting to a fixed SRID: a projection is
  only accurate near its own meridian (measuring every city through UTM zone 18N overstated street distances by up
  to +51% — issue #4641).
- **Two performance gotchas:** count rows with `.size.result` (emits `COUNT(*)`), **not** `.length.result` (which
  loads every row into memory); for CPU-heavy work use the `cpu-intensive` `ExecutionContext` rather than the default
  (see existing usages).
- **Document with ScalaDoc** (`/** ... */`) on every class/trait/object and non-trivial method, including `private`
  ones. Full template and rules in [`CLAUDE.md`](../CLAUDE.md).

## Public API (`/v3`)

The API has its own naming contract: **output field names are `snake_case`** (JSON, GeoJSON properties, CSV headers,
shapefile/geopackage fields) while **query/REST parameters are `camelCase`**. New API DTOs go in `app/models/api/`.
The full convention — including the snake_case `JsonConfiguration` pattern and the `StreamingApiType` serialization
shape — is in the API sections of [`CLAUDE.md`](../CLAUDE.md).
