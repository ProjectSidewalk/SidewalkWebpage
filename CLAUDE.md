# CLAUDE.md

Project Sidewalk is a web-based crowdsourcing tool for mapping and assessing sidewalk accessibility. Scala 2.13 +
Play 3.0 (Java 17) backend, Postgres + PostGIS via Slick, and a vanilla-JS frontend that Grunt concatenates (no
transpile, no minify, no module system), all run in Docker. Request flow is routes → Controller → Service → Table
(DAO). Architecture tour: `docs/architecture.md`. Setup, daily commands, troubleshooting: `docs/dev-environment.md`.

## 🚨 NEVER READ `docker-compose.override.yml` 🚨

Real live secrets, nothing enforces this but you. Never open it, never print or commit a value from it, and exclude
it from wide `grep`/`find`/`cat *` sweeps. Ask the maintainer for a value; `docker-compose.yml` has dummy equivalents.

This file holds only cross-cutting rules. Detail lives in `docs/` and loads on demand: path-scoped rules in
`.claude/rules/` surface the essentials when you read a matching file, and the table says which doc to read first
when a task is in its area.

| Working on… | Read first |
|---|---|
| A schema change (`conf/evolutions/`) | `docs/evolutions.md` |
| A `/v3/api` endpoint or `app/models/api/` | `docs/architecture.md` → "The public API" (and the `update-apis` skill) |
| Translations (`conf/messages/`, `public/locales/`) | `docs/internationalization.md` |
| CSS, Twirl views, any UI | `docs/style-guide.md`, `docs/accessibility.md` |
| A new or changed user interaction | `docs/logged-events.md` |
| Releases, deploys, asset caching, persistent media dirs | `docs/deployment-and-stages.md` |
| Storing uploaded media (DB row vs. media dir) | `docs/architecture.md` → "Media storage" |
| Tests or CI | `docs/testing-and-ci.md`, `test/e2e/README.md` |
| `scripts/*.py` | `scripts/README.md` |
| Google Maps keys, quotas, or a Google Cloud bill | `docs/google-cloud.md` |
| The label lat/lng estimator or the labeling viewport frame | `docs/label-latlng-estimation.md` |

## Workflow

- `develop` is the main branch and the PR target; `master` is the release branch. Branch names start with the
  issue number (`1234-fix-label-popup`).
- **Never open a pull request, merge, tag, or release without the maintainer's explicit OK.** Do the work, run the
  checks, push the branch if useful, then stop and ask. Filing GitHub issues is fine. Maintainers: @jonfroehlich
  and @misaugstad.
- Prod deploys are tag-triggered (`vX.Y.Z` on `master`); pushing `develop` redeploys the test stage.
- Edit `src/` files only. Never run grunt or edit `build/` output: the developer's `npm start` runs `grunt watch`.
  A new `src/` file must match a glob in `Gruntfile.js`.
- Keep docs in sync in the same change. `docs/architecture.md` is the human-facing architecture reference; exact
  dependency versions live only in `docs/upgrading-libraries.md`.
- Never browser-test anything that needs a street-view panorama (placing labels, validating). Hand the developer a
  checklist or console snippet instead. The `test/e2e/` suite only *loads* Explore's tutorial and Validate's landing
  state; don't extend it into pano interaction.

## Before a change is done

- **Scala:** `make scalafmt-fix` (a blocking CI gate). Compile check without fighting the developer's `sbt ~ run`:
  `docker exec projectsidewalk-web bash -lc "cd /home && sbt --client compile"`. `-Xfatal-warnings` is on, so a
  success is warning-clean.
- **Frontend:** `make lint` (ESLint, Stylelint, HTMLHint, locale parity, CSS layout, asset paths, evolutions lint;
  all blocking CI gates), or scope it with `make eslint dir=…` / `make stylelint dir=…`. `make lint-fix` handles the
  mechanical fixes. The tree is lint-clean, so any finding is from your change.
- **Tests:** `sbt --client test` (same `docker exec`; needs the db container), `make test-js` (jsdom unit suite),
  `make test-e2e` against a running app, `make test-python`. Details and what CI gates: `docs/testing-and-ci.md`.

## Conventions the linters can't check

- **ES2022.** As you touch code, modernize it: constructor functions → `class` with `#private` fields, jQuery →
  `fetch` + Promises, Bootstrap → native (defer a refactor that would ripple through many callers). Build HTML with
  template literals, never `+` concatenation.
- **Comments say *why*, never what.** ScalaDoc (`@return`) / JSDoc (`@returns`, typed `@param`) on every class and
  non-trivial method, including private ones. Never describe what code *used to* do; git history has that, and a
  hook flags it. Templates: `docs/style-guide.md` → "Comments".
- 120-char lines (exceptions where a break would hurt readability), 2-space indent. SQL: no table aliases.
  Distances are geodesic (`ST_Length(geom::geography)`, Slick `lengthGeodesic`, turf.js), never via a fixed SRID.
- A server-to-server POST authenticated by the internal key (`ControllerUtils.internalKeyValid`) needs a `+ nocsrf`
  line above its `conf/routes` entry, or the CSRF filter 403s every real request while curl tests look fine.
- Mobile detection has one definition, `ControllerUtils.isMobile`; JS reads `util.isMobile()`. Never re-sniff the UA.
- User interactions are logged (clicks, key presses, mode switches, …). When you add or change one, add or adjust
  the logging and update `docs/logged-events.md`.
- All user-facing text is translated into every supported language (en, es, nl, de, pt-BR, zh-TW, plus the
  en-US/en-NZ overlays). Backend English goes in `conf/messages/messages.en`, never the base `messages`. Prefer
  `data-i18n="ns:key"` in HTML.
- UI meets WCAG 2.1/2.2 AA and is styled from the `main.css` `:root` tokens and `.ps-*` primitives:
  `font: var(--text-*)` rather than raw font properties, px never rem, no hardcoded hex. Tool-UI dimensions are
  `calc(<n>px * var(--ui-scale, 1))`.
- Assets are named by logical path, never by URL: `assets.path("…")` in Twirl and `util.assetPath('…')` in JS,
  never a hardcoded `/assets/` string (only those resolve to the fingerprinted, immutable URL; `make lint-asset-paths`
  is the gate). CSS is the exception: a `url()` names a real file under `public/`, in either form, and a build stage
  fingerprints it.

## Backend is the source of truth

Domain values (enum members, ranges, thresholds, and especially the mappings between them) come from the backend, a
`/v3/api/...` endpoint or a value the controller passes to the view, and are never re-declared as frontend literals.
Even a "trivial" constant encodes logic: severity 1–3 maps to good/ok/bad in opposite directions for positive
features (curb ramps) and negative ones (obstacles). Source it; if no source exists, expose one as part of the task;
only if genuinely unavoidable, centralize the literal with a comment saying why it isn't sourced.

## Label type colors and icons

| Label type | Color | | Label type | Color |
|---|---|---|---|---|
| CurbRamp | `#90C31F` | | NoSidewalk | `#BE87D8` |
| NoCurbRamp | `#E679B6` | | Crosswalk | `#FABF1C` |
| Obstacle | `#78B0EA` | | Signal | `#63C0AB` |
| SurfaceProblem | `#F68D3E` | | Other, Occlusion | `#B3B3B3` |

Never invent substitute colors. In JS call `util.misc.getLabelColors(labelType)` (`public/js/common/UtilitiesSidewalk.js`);
`/v3/api/labelTypes` is canonical. The marker icon is `public/images/icons/label_type_icons/{LabelType}_small.svg`,
reached through `util.misc.getIconImagePaths(labelType).iconImagePath`, and it is the only variant frontend code may
use (the Explore canvas rasterizes it itself). The `.png` sizes beside it exist for server-side share images and the
API's `icon_url` fields only.

## Working with the running app

- Everything runs in Docker (`make dev`). The developer usually has it up: check `docker ps` and reuse. The app is
  at http://localhost:9000; `WebFetch` can't reach it, so use `curl`.
- Most routes need a session: `curl -s -c /tmp/sidewalk_cookies.txt "http://localhost:9000/anonSignUp?url=%2F"`
  once, then pass `-b /tmp/sidewalk_cookies.txt`. Admin-role QA and running a worktree's branch
  (`make qa-worktree wt=<name>`): `docs/dev-environment.md`.
- Inspect the DB read-only: `docker exec projectsidewalk-db psql -U readonly_user -d sidewalk -c "…"` (never
  `-U sidewalk`). One schema per city (`sidewalk_seattle` is a safe default for schema questions), auth in
  `sidewalk_login`. For data or migration state, the active schema is `$DATABASE_USER` in the web container, and
  `readonly_user` may have no rights on it: `\dt` silently omits what it can't see, so enumerate with `pg_namespace`
  and query as the city's own role. Evolutions auto-apply when a page loads. The dev DB is tiny and omits the two
  heavyweight tables, `audit_task_interaction` and `validation_task_interaction`; never infer prod size from it.
