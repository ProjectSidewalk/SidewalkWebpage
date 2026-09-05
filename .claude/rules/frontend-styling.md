---
paths:
  - "public/css/**"
  - "app/views/**"
---

# Styling and Twirl views

Full rules: `docs/style-guide.md` (tokens, primitives, file layout, naming) and `docs/accessibility.md`.

- **Style from the `main.css` `:root` tokens and primitives.** `font: var(--text-*)` (a complete shorthand; override
  one property after it rather than dropping to raw `font-*`), `--color-*`, `--space-*`, `--border-radius*`,
  `--box-shadow*`, `--z-index-*`; `.button-ps`, `.ps-input`, `.ps-select`, `.ps-table`. A hardcoded hex or a
  hand-assembled font stack is a bug. `--font-size-*` / `--color-text-*` names are dead aliases, not tokens.
- **px, never rem** (Bootstrap sets `html { font-size: 62.5% }`, so `1rem` is 10px). **Raleway is display-only and
  never renders digits.** Breakpoints: write the px and name the `--breakpoint-*` token in a comment.
- **Tool UI scales:** every fixed dimension in Explore/Validate and their overlays is
  `calc(<n>px * var(--ui-scale, 1))`; fixed page chrome like the navbar stays unscaled.
- **`public/css/` layout is linted** (`make lint-css-layout`): root holds only `main.css` + `fonts.css`;
  `components/` for anything two pages link (prefix `ps-` or component-named); `pages/` for page-specific files,
  registered in the lint's `PAGES` map and linked only by their page; a page's class prefix lives only in its own
  stylesheet. `components/page-shell.css` is shared by the API docs and both dashboards. Never `@import`.
- **CSS `url()` just names a real file** — absolute or relative, nothing to register; a build stage rewrites it to the
  fingerprinted name (`docs/deployment-and-stages.md` → "Asset caching"). Naming a file that isn't there fails
  `make lint-asset-paths` and the stage build, so add the asset first.
- **Twirl:** every asset through `assets.path("…")` (JS uses `util.assetPath('…')`), never a hardcoded `/assets/`
  string; only those resolve to the fingerprinted, immutable URL, and `make lint-asset-paths` gates the JS side. No
  inline styles or scripts; `alt` on every image; prefer `data-i18n="ns:key"`. Icons are their own files in
  `public/images/icons/`, never inlined SVG.
- **Accessibility gate:** every page in `test/e2e/pages.js` is held to WCAG 2.1 AA by axe; new controls are real
  semantic elements with names and keyboard handlers. Allowlisting a violation is a last resort and needs an issue.
