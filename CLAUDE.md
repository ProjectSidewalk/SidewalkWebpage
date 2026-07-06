# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Project Sidewalk is a web-based crowdsourcing tool for mapping and assessing sidewalk accessibility. The backend is **Scala + Play Framework 3.0** (Scala 2.13, Java 17) with a **Postgres + PostGIS** database accessed via **Slick** (with slick-pg for spatial/JSON types). The frontend is **vanilla JavaScript**, organized as several independent apps that are bundled with **Grunt** (concatenation only — no transpilation/minification). Everything runs in **Docker** for development.

## Backend architecture

> Human-facing companion: [`docs/architecture.md`](docs/architecture.md) covers this same architecture as narrative
> contributor docs (and is what the README links to). Keep the two in sync when architecture changes; this file
> stays the AI-facing reference and adds the operational/tooling notes below.

Request flow: **routes → Controller → Service → Table (DAO)**.

- **`conf/routes`** — single routes file mapping URLs to controller methods. The public data API lives under `/v3/api/...` (handlers in `app/controllers/api/`).
  - **v3 API naming convention (issue #3871):** query/REST **parameters are camelCase** (`minSeverity`, `regionId`, `validationStatus`); **all output field names are snake_case** — JSON bodies, GeoJSON `properties`, CSV headers, and GeoPackage fields (`label_id`, `region_name`, `city_id`) — one canonical field name across those formats. For macro serializers, use a scoped `JsonConfiguration(JsonNaming.SnakeCase)` so `Json.format`/`Json.writes` emit snake_case. `ApiError.parameter` names a query param, so it stays camelCase. **Known exception — Shapefile/DBF:** shapefile fields stay **camelCase and abbreviated** (`labelId`, `regionName`, `osmWayId`, `neighborhd`, `cameraHdng`) because the DBF format hard-truncates field names to 10 chars, so they can't carry the canonical snake_case names regardless of casing — camelCase reclaims the byte the underscore would waste. Shapefile is a legacy export being phased out; **GeoPackage is the modern GIS export that carries the canonical snake_case names** (decided on #3871, 2026-06-25). v3 is a **preview** surface: breaking changes are made in place rather than minting a new version (precedent: #4223).
- **`app/controllers/`** — thin HTTP layer. Auth-protected actions use **Silhouette** (`SilhouetteModule.scala`, `app/models/auth/`). `app/controllers/api/` holds the versioned public API controllers.
- **`app/service/`** — business logic (e.g. `LabelService`, `ValidationService`, `ExploreService`, `AccessScoreService`, `ApiService`). Controllers should delegate here rather than touching tables directly.
- **`app/models/`** — Slick table definitions and queries, grouped by domain (`label/`, `validation/`, `mission/`, `region/`, `street/`, `route/`, `user/`, `cluster/`, `gallery/`, `api/`, ...). Files named `*Table.scala` define schema + queries (DAO pattern).
- **`app/models/utils/MyPostgresProfile.scala`** — custom Slick Postgres profile wiring in PostGIS geometry, JSON, and other slick-pg extensions. Spatial query helpers are in `SpatialQueryDefs.scala`.
- **DI**: Guice. App bootstraps via `app/CustomApplicationLoader.scala`; modules registered in `conf/application.conf` and defined in `app/modules/` (`CustomControllerModule`, `ActorModule`, `ExecutorsModule`, `SilhouetteModule`). Custom execution contexts are in `app/executors/`; background actors in `app/actor/`.
- **Views**: Twirl templates (`app/views/*.scala.html`). The sbt build silences warnings in `views/` and the routes file specifically.

### API data structures (`app/models/api/`)

The data structures (DTOs) returned by the public `/v3` API live in **`app/models/api/`** (`package models.api`), in
per-domain files named `*ApiModels.scala` (`LabelApiModels.scala`, `StreetsApiModels.scala`, `UserStatsApiModels.scala`,
...). This is the canonical home — do **not** define new API DTOs inside `*Table.scala` DAO files (issue #3885). Each DAO
file produces its DTOs but the DTO *definitions* belong in `models.api`. The convention:

- **Naming**: response types are `*ForApi` (e.g. `LabelDataForApi`, `UserStatForApi`); parsed query filters are
  `*FiltersForApi` (e.g. `RawLabelFiltersForApi`).
- **Streaming**: response DTOs extend **`StreamingApiType`** (`app/models/api/StreamingApiType.scala`) and implement
  `toJson` / `toCsvRow` **inline** on the case class, so `BaseApiController`'s `outputJSON`/`outputCSV`/`outputGeoJSON`
  helpers can serialize a stream of them uniformly. Serialization lives *on the DTO*, not as free functions elsewhere.
- **Companion object** holds the `csvHeader` string (keep it next to `toCsvRow` so columns can't drift) and JSON writers.
- **snake_case JSON** per #3871: derive writers with a scoped `JsonConfiguration(JsonNaming.SnakeCase)` +
  `Json.format`/`Json.writes`, or hand-build the `JsObject` with snake_case keys for nested/custom shapes.
- **Shared helpers**: reuse `ApiModelUtils` (`escapeCsvField`, `createGeoJsonPointGeometry`, ...) rather than re-rolling
  CSV/GeoJSON logic.

`app/formats/json/ApiFormats.scala` still holds assorted older non-DTO writes (the v2 access-score serializers and the
`ClusterForApi` stack were removed in #3864); new API DTOs should not add to it — define them in `models.api` per the
convention above.

### Database & evolutions

Schema changes are **Play evolutions**: numbered SQL files in `conf/evolutions/default/`. Add the next-numbered file for schema changes; each has `# --- !Ups` and `# --- !Downs` sections. The dev DB is seeded from a dump — see [`db/scripts/README.md`](db/scripts/README.md) for the full DB lifecycle/maintenance scripts (`import-dump`, `create-new-schema`, etc., exposed as `make` targets). Connection config is env-driven (`DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD`) in `conf/application.conf`.

**Every `CREATE TABLE` must be followed by `ALTER TABLE <name> OWNER TO sidewalk;`** in the same evolution (see 309.sql for the pattern). On the prod server, evolutions run as an admin role, so a new table would otherwise be owned by that role and the `sidewalk` app role would lack permissions on it. This applies to **tables only** — it's easy to forget, and a missed one has to be patched by a later evolution (e.g. 321.sql fixed 314.sql; 329.sql fixed 326.sql/327.sql). Note:
- **SERIAL / identity sequences** are covered automatically: `ALTER TABLE … OWNER TO` recursively reassigns any sequence a column owns, so no separate statement is needed for them.
- **Enum types, views, and standalone (non-column-owned) sequences do *not* get an owner change** — the app only needs default `USAGE`/`SELECT` on those, which it already has, and they're never altered at runtime. Don't add `OWNER TO` for them.

## Frontend architecture

Each major UI is a self-contained app under `public/javascripts/`, bundled separately by Grunt and loaded by the corresponding Twirl view:

- **`SVLabel/`** — the Explore/Audit tool (users label accessibility issues on street-view panoramas). The largest app.
- **`SVValidate/`** — the Validate tool (users confirm/reject others' labels).
- **`Gallery/`** — browsable gallery of labels with filtering.
- **`Admin/`** — admin dashboards and maps.
- **`Progress/`** — user dashboards.
- **`PSMap/`** — shared map component used across pages.
- **`Help/`** — help/faq page (rarely used).
- **`common/`** — shared modules pulled into multiple bundles: `pano-viewer/` (abstraction over GSV / Mapillary / Infra3d / Pannellum imagery providers), `label-detail/` (label popups), and various utilities.

No npm-based module system on the frontend — files are simply concatenated in order. External libraries are in `public/javascripts/lib/`.

## Internationalization
Two separate i18n systems:
1. **Backend**: Play i18n with message files in `conf/messages/` (server-rendered strings)
2. **Frontend**: JSON files in `public/locales/{lang}/common.json` (client-side strings)

Supported languages: en, es, nl, zh-TW, de, pt-BR, en-US, en-NZ.

User-facing text changes require translations for all supported languages

Lean towards using `data-i18n="ns:key"` in HTML so that we can keep the translations in the i18next JS library and reduce duplicate translations.

Full details (both systems, regional `en-US`/`en-NZ` rules, adding a new language): [`docs/internationalization.md`](docs/internationalization.md).

## Configuration

- `conf/application.conf` is the base; environment overlays are `application.local.conf`, `application.staging.conf`, `application.test.conf`. `npm start` runs with `application.local.conf`.
- Per-city settings: `conf/cityparams.conf` (selected via `SIDEWALK_CITY_ID`). Many secrets/keys come from env vars (Mapbox, Google Maps, Gemini, Mapillary, Infra3d, Silhouette signer/crypter); dev defaults are dummy values in `docker-compose.yml`, with real local values in `docker-compose.override.yml` (hidden from Claude, ask if you need to know something like the city-id).

## Python utilities

Two standalone scripts in **`scripts/`**, invoked out-of-band rather than from the running web app. Python deps are split by who needs them: **`requirements.txt`** holds the app's in-band deps (`label_clustering.py` runs in-band — see below), and **`requirements-offline-tools.txt`** holds the deps used only by the offline `check_streets_for_imagery.py` utility (`shapely`, `geopy`, `tenacity`, `tqdm`). The Docker image installs both (plus `requirements-dev.txt`) since the test suite imports both scripts. Full usage in [`scripts/README.md`](scripts/README.md):

- `scripts/label_clustering.py` — clusters nearby labels. This one is invoked **in-band**: `ClusterService.runMultiUserClustering` shells out to `scripts/label_clustering.py` per region during admin-triggered `/runClustering` and the nightly `ClusteringActor` run (see `app/service/ClusterService.scala` / `app/models/cluster/`). If you move/rename it, update that invocation path. Because it runs in-band, the deployed app must be able to find it: `scripts/` is bundled into the staged/dist package via `Universal / mappings` in `build.sbt`, and `ClusterService` resolves the script against the app root (Play `Environment`) rather than the process working directory — a staged app runs from the stage dir, not the repo root, so a working-directory-relative path or an unbundled script fails with a cryptic python exit-2 ("can't open file"). Its `requirements.txt` deps must also be installed in the `python3` the app invokes.
- `scripts/check_streets_for_imagery.py` — checks streets for available street-view imagery (related: `make hide-streets-without-imagery`). Resolves its data files relative to the repo root, so it runs from any working directory.

Each script's pure logic is refactored into importable functions and **unit-tested** under `test/python/` (`pytest`). Keep I/O (HTTP/file) in thin wrappers and `main` so the logic stays testable; run `make test-python`.

## Label Type Colors and Icons

Every label type has a **canonical color** and a set of **icon images**. Always use these — never invent substitute colors.

| Label Type     | Color     |
|----------------|-----------|
| CurbRamp       | `#90C31F` |
| NoCurbRamp     | `#E679B6` |
| Obstacle       | `#78B0EA` |
| SurfaceProblem | `#F68D3E` |
| NoSidewalk     | `#BE87D8` |
| Crosswalk      | `#FABF1C` |
| Signal         | `#63C0AB` |
| Other          | `#B3B3B3` |
| Occlusion      | `#B3B3B3` |
| Problem        | `#B3B3B3` |

**Icons** live in `public/images/icons/label_type_icons/` in three sizes: `{LabelType}.png` (large),
`{LabelType}_small.png`, and `{LabelType}_tiny.png`. The canonical source of truth for both colors and icon URLs
is the `/v3/api/labelTypes` endpoint.

**In JavaScript:** call `util.misc.getLabelColors(labelType)` — defined in
`public/javascripts/common/UtilitiesSidewalk.js` and loaded on every page that includes
`app/views/apiDocs/layout.scala.html` or the main app bundles. Do **not** hardcode the hex values in
feature code; use `getLabelColors()` so colors stay in sync automatically.

## Backend is the source of truth — avoid hardcoded literals in the frontend

The [Label Type Colors and Icons](#label-type-colors-and-icons) rule (colors/icons come from
`/v3/api/labelTypes`, read via `getLabelColors()`) is one instance of a broader discipline: **domain values —
enum members, value ranges (min/max), thresholds, and especially the *mappings* between them — must come from
the backend** (a `/v3/api/...` endpoint, or a value the controller injects into the Twirl view), **not be
re-declared as literals in JavaScript.** A hardcoded frontend copy silently drifts from the backend the moment
either side changes, and nothing catches it.

**The trap: a value that *looks* trivial often encodes domain logic.** Severity is `1`–`3`, but the
`good`/`ok`/`bad` interpretation is **not** a fixed mapping. **Positive** access features (e.g. curb ramps,
where the feature's *presence* is good) and **negative** access features (e.g. obstacles, surface problems,
where presence is bad) map severity to quality in **opposite** directions. So a frontend
`const quality = {1: 'good', 2: 'ok', 3: 'bad'}` is wrong for half the label types — and even if it were
right today, it would rot the next time the backend's logic changed. This is exactly the kind of literal to
never hand-write on the frontend.

**What to do, in order of preference:**
1. **Source it** — pull the value/range/mapping from an existing API endpoint, or from a value the controller
   passes into the view.
2. **Expose it** — if no such source exists but the value is non-trivial or shared with the backend,
   add/extend an endpoint or view binding to surface it, and treat that as part of the task rather than
   hardcoding a copy.
3. **Centralize + justify** — only if a literal is genuinely unavoidable (a purely presentational constant
   with no backend counterpart), define it in one place and comment *why* it isn't sourced from the backend.

When you catch yourself writing a frontend constant that mirrors a backend value, stop and source it instead.

## Development Guidelines
- Main development branch is **develop**; **master** is the release branch. PRs target `develop`.
- **Maintainers / GitHub @-mentions:** Project Sidewalk is maintained by **@jonfroehlich** (Professor Jon Froehlich) and
  **@misaugstad** (Mikey / Michael Saugstad).
- If there is an associated Github issue, beging the branch name with the issue number (e.g. `1234-fix-label-popup`).
- When changing JS behavior, edit `src/` and let `grunt watch` rebuild; if a new `src/` file isn't picked up, check that its path matches a glob in `Gruntfile.js`.
- When updating code in JavaScript, migrate it to modern ECMAScript — we target **ES2022** (the `ecmaVersion` in [`eslint.config.js`](eslint.config.js)): `let`/`const` instead of `var`, arrow functions, `#private` class fields, `async`/`await`, optional chaining (`?.`), etc.
- Build HTML strings with **template literals, never `+` concatenation**, indenting the markup inside the backticks to mirror its HTML nesting (ESLint doesn't reformat template-literal interiors). The newlines/indent become part of the string, so when converting an old concatenation, check the target container's CSS first — safe in block/flex/grid containers and collapsible inline text, but a plain inline container gains a visible space, and a line break inside an attribute value (e.g. `title="..."`) renders literally. `eslint --fix` can't do this conversion (`prefer-template` ignores literal-plus-literal chains), so convert by hand as you touch code. Full write-up: [`docs/style-guide.md`](docs/style-guide.md).
- When refactoring a JS constructor function (the `function Foo(...) { const self = this; ... return self; }` pattern), convert it to a `class`. Use `#` private fields/methods. Use arrow functions in event listeners to keep `this` bound correctly.
- Update said code to use the native `fetch` API rather than jQuery, and to make use of Promises. But if said refactor would impact many other functions that use it, then wait for a dedicated refactor.
- Replace uses of Bootstrap with native JS alternatives as you come across them
- When writing SQL, avoid table aliases
- After editing any Scala file, run `make scalafmt-fix` (reformats the whole tree in place via the sbt thin client) before treating the change as done — scalafmt is a blocking CI gate, so unformatted Scala fails the build. One run after a batch of edits is enough; no need to format after every single edit.
- After editing any JavaScript file, run `make eslint-fix dir=<files or dirs you touched>`, then hand-fix anything `--fix` couldn't resolve — **`make eslint` must pass (zero errors/warnings) before the change is done**. The whole tree is lint-clean (#2487), so a bare `make eslint` should come back green; any finding it reports is yours to fix. ESLint is now a **blocking CI gate** (a step in the `frontend` job — see Continuous integration), the JS counterpart to the scalafmt rule above, so failing lint fails the build.
- User interactions are logged (clicks, key presses, mode switches, pano changes, mission/task events, etc.) to the activity/interaction tables. When you **add or change an interaction**, add or adjust the corresponding logging so analytics stay complete; keep event names consistent with the existing ones, and update [`docs/logged-events.md`](docs/logged-events.md) (how logging works + the event reference).
- Ensure WCAG 2.1/2.2 Level AA accessibility standards are met
- When adding or refactoring code, use the fonts, colors, button styling, etc. defined in main.css :root. These are pulled from our "Design System Tokens" Figma, and we are pushing to use these going forward.
- Max line length of 120 characters, with long line exceptions where appropriate. For multi-line comments, TARGET line length is 120 characters
- **Keep docs in sync.** When you change architecture, framework versions, supported languages, label types, or other conventions, update the affected docs in the *same* change: [`docs/architecture.md`](docs/architecture.md) mirrors this file's architecture (and the README's tech-stack summary), and [`CONTRIBUTING.md`](CONTRIBUTING.md) holds the workflow/standards. To avoid drift, keep exact dependency/patch versions in **one** place — the dependency-version inventory ([`docs/upgrading-libraries.md`](docs/upgrading-libraries.md)) — rather than copying them across docs. README/architecture mention only stable major versions (e.g. Scala 2.13, Play 3.0, Java 17).

## Code Commenting Standards

Comments communicate **why** code makes a choice — not **what** it does (well-named identifiers handle that). Follow the
language-specific conventions below so that IDEs, documentation generators, and the next developer can consume them.

### Scala (ScalaDoc)

Use `/** ... */` for all ScalaDoc. Every class, trait, object, and non-trivial method gets one — including `private`
methods. Private methods are read by the next developer, not just public API consumers.

**Method / function:**
```scala
/**
 * One-line summary of what this does or returns.
 *
 * Longer description when the contract, preconditions, or edge cases need more room.
 * Separate from the summary with a blank line; keep each line under 120 chars.
 *
 * @param name  Description. Don't repeat the type — it is already in the signature.
 * @param other Description. Align multi-param descriptions for readability.
 * @return      What is returned and meaningful edge cases (e.g. `None` if absent,
 *              `Left(ApiError)` if malformed, `Right(Some(...))` if valid).
 */
```

**Class / trait / object / companion:**
```scala
/**
 * One-line description of this type's single responsibility.
 *
 * Longer description if construction semantics, lifecycle, or thread-safety matter.
 *
 * @param cc  Description of constructor param (omit implicit/DI-only params).
 */
```

Rules:
- Use `@return` (not `@returns`) — that is the ScalaDoc standard.
- Align `@param` descriptions when there are multiple — consistent with Play/Slick/Scala stdlib style.
- Omit `@throws` unless the exception is part of the intentional public contract.
- Do not document implicit params that are pure DI plumbing details.
- Trivial one-line helpers (simple delegators, obvious getters) may omit the header.

### JavaScript (JSDoc)

Use `/** ... */` for all JSDoc. Every `class` and every non-trivial method gets one — including `#private` methods.
Type annotations in `@param` are especially important in JS because there is no static type checker.

**Method / function:**
```javascript
/**
 * One-line summary.
 *
 * Longer description when needed. Keep lines under 120 chars.
 *
 * @param {string} name - Description. Mark optional params as {string} [name] = defaultValue.
 * @param {number} count - Description.
 * @returns {boolean} What is returned; include edge cases (null if not found, etc.).
 */
```

**Class:**
```javascript
/**
 * One-line description of the class's single responsibility.
 */
class Foo {
    /**
     * @param {string} name - Description.
     */
    constructor(name) { ... }
}
```

Rules:
- Use `@returns` (not `@return`) — that is the JSDoc standard (opposite of ScalaDoc).
- Always include `{Type}` in `@param` and `@returns`.
- Use `{Type} [paramName]` (square brackets) for optional parameters.
- Use `{Type} [paramName=default]` when a default exists and is non-obvious.
- Trivial one-line helpers may omit the header.

### Inline comments

Use `//` for inline comments within a body. Write the **why**, never the what:

```scala
// bbox takes precedence over region filters per the v3 API contract (#3871).
val finalBbox = if (bboxActive) parsedBbox else ...
```

not:

```scala
// check if bbox is active   ← restates the code; adds no value
val finalBbox = if (bboxActive) parsedBbox else ...
```

Good targets for inline comments:
- Non-obvious algorithmic choices or ordering constraints that must be preserved.
- Business rules and domain invariants that aren't apparent from identifiers alone.
- Workarounds for external bugs, framework quirks, or surprising behavior.
- Why a specific constant or threshold was chosen (link to issue/spec if possible).
- Branches where the "looks-wrong" path is actually correct.
- `firstError`-style validation sequences where the order of checks matters.

### What not to comment

- Do not restate what the code obviously does.
- Do not describe what the code *used to* do, or narrate a change — that is changelog, and git
  history already records it. This is the single most common offender: a diff renames or replaces
  something, and a comment gets added to explain the *before*. The reader only needs the current
  contract; if a comment is only meaningful read against the diff, delete it. Applies everywhere,
  but especially in tests and `models/` DAO/DTO files. Concretely (from a real rename PR):

  ```scala
  // BAD — narrates the rename; only makes sense next to the diff:
  // region_id + region_name replace the old neighborhood field (#3980).
  body must not include "neighborhood" // now region_name (#3980)

  // GOOD — the assertions already state the current contract; no comment needed:
  body must include("region_id,region_name")
  body must not include "neighborhood"
  ```

  Tells that you are writing one of these and should stop: *used to*, *previously*, *formerly*,
  *replaces the old*, *renamed to/from*, *no longer*. A `PostToolUse` hook in `.claude/settings.json`
  flags these on save — if it fires, rewrite to state only the current behavior.
- Do not leave `TODO`/`FIXME` in committed code without a linked tracking issue.
- Do not add a header just because a function was touched; only add one if it is missing
  and the function is non-trivial.

## Linting Rules (`make eslint` must pass before check-in — now a blocking CI gate for JS, like Scala `scalafmt`; htmlhint/stylelint still manual — see Continuous integration)
- ESLint: ES2022, `const`/`let` only (no `var`), arrow functions, template literals, semicolons required, 120-char line limit
- Stylelint: 4-space indentation, stylelint-config-standard
- HTMLHint: lowercase tags/attrs, double quotes, no inline scripts/styles, alt text required

## Testing the Local Web App

Everything runs inside Docker; the `Makefile` wraps `docker-compose`. A developer typically already has the app running, so before starting your own containers, check whether they're up (`docker ps`) and reuse them.

```bash
make dev            # start the db container, then drop into a shell in the web container
                    # (= make docker-up-db + make docker-run)
make docker-up      # start all services detached
make docker-stop    # stop and remove containers
make ssh target=db  # exec into a running container (projectsidewalk-db / -web)
```

> Human-facing companions to this section: [`docs/dev-environment.md`](docs/dev-environment.md) (full setup —
> prerequisites, WSL2, city switching, troubleshooting) and [`CONTRIBUTING.md`](CONTRIBUTING.md) (workflow + coding
> standards). This file stays the AI-facing reference; those are written for contributors.

Inside the web container shell, the developer starts the app with `npm start` (runs Grunt concat + watch in the background, then `sbt run` — i.e. `sbt ~ run`, continuous recompile; `npm run debug` adds a JVM debug port). It serves on **http://localhost:9000** using `conf/application.local.conf`. First compile is slow (sbt resolves dependencies); sbt keeps its caches inside the project dir (`.coursier`, `.sbt`).

### Verifying backend (Scala) changes compile

For a quick pass/fail without running tests, validate backend changes by compiling. The clean way is the **sbt thin client**, which runs against its own dedicated server and so does *not* fight the developer's running `sbt ~ run` (a plain second `sbt compile` collides with it over build/target locks and hangs):

```bash
docker exec projectsidewalk-web bash -lc "cd /home && sbt --client compile"
```

- First call per container boot is ~30s (it starts the dedicated compile server); every call after is near-instant (warm server reuse).
- It compiles whatever is **saved on disk**, so it reflects uncommitted edits. `build.sbt` sets `-Xfatal-warnings`, so a `[success]` means warning-clean too (unused imports/params, dead code, value discard all fail the build).
- It only needs the web container up — the app itself (`npm start`) does not have to be running.

Alternatively, since the developer's `sbt ~ run` recompiles on save, hitting any route over HTTP (see below) also forces a compile; errors surface as a 500 page rather than clean output, so prefer the thin client when you just want a pass/fail.

### Running tests

There **is** a backend test suite (ScalaTest via `scalatestplus-play`), under `test/` — mostly public-API functional specs in `test/controllers/api/`, plus `test/models/api/` and `test/formats/json/`. Run it with the thin client:

```bash
docker exec projectsidewalk-web bash -lc "cd /home && sbt --client test"                                # whole suite
docker exec projectsidewalk-web bash -lc "cd /home && sbt --client \"testOnly controllers.api.PublicApiSpec\""
```

The API specs **boot the real app against Postgres+PostGIS**, so the `db` container must be up; they assert response contract/shape, not data values. There is no `make` target — invoke sbt directly. The phased testing strategy and rationale live in [`docs/testing-and-ci.md`](docs/testing-and-ci.md).

A prototype **JS** test layer (jsdom) lives under `test/js/` — run `npm run test:js`. It is opt-in and not wired into CI yet (sequenced with the ES5→ES2022 migration, #2487); see `test/js/README.md`.

A **Python** unit suite (`pytest`) for the `scripts/` utilities lives under `test/python/` — run `make test-python` (runs pytest in the web container) or `docker exec projectsidewalk-web bash -lc "cd /home && python3 -m pytest test/python"`. It needs no DB/network (pure-logic tests only) and runs as an **advisory** CI job; see `test/python/README.md`.

### Continuous integration

`.github/workflows/ci.yml` runs on PRs and pushes to `develop`/`master`: backend **`sbt compile`** (blocking gate), **`scalafmtCheckAll`** (blocking — the tree is kept format-clean; auto-format with `make scalafmt-fix` / `sbt scalafmtAll`, config in `.scalafmt.conf`), the **frontend grunt build** plus **ESLint** (blocking — `npx eslint public/javascripts/` as a step in the `frontend` job, so it rides the required `Frontend (build)` check; blocks on `error` rules, while the lone `warn` rule `max-len` is advisory so there's no `--max-warnings 0`; the JS tree is kept lint-clean, auto-fix with `make eslint-fix`; htmlhint/stylelint not yet wired in — #2487), the **evolutions lint** (blocking — static checks on `conf/evolutions/default/*.sql`, e.g. a semicolon mid-`--`-comment that Play's parser splits on; run locally with `make lint-evolutions`), and the **DB-backed API tests** (advisory while the suite stabilizes — boots the app, so it also exercises forward evolution application). "Advisory" steps report findings but don't block merges yet. **Branch protection** on `develop` (set 2026-06-29) wires the deterministic blocking jobs as **required status checks** (`Backend (compile + scalafmt)`, `Frontend (build)` — now also covers ESLint; `Evolutions lint` being added) so a red build can't merge; `enforce_admins=true`, **no required reviews** (self-merge preserved), advisory jobs not required. Full policy: [`docs/testing-and-ci.md`](docs/testing-and-ci.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

### Building frontend assets

JS/CSS is concatenated by Grunt (see `Gruntfile.js`) and rebuilt automatically by the `grunt watch` that `npm start` runs — so when a developer has the app up, your saved `src/` edits are bundled for you. **Do not run `grunt`/`npm run grunt-concat` yourself and do not edit the `build/` output.** Edit the `src/` files only; bundles are written to `public/javascripts/*/build/`. If a new `src/` file isn't picked up, check that its path matches a glob in `Gruntfile.js`. Concatenation order matters and is hand-specified there (e.g. `PopupPanoManager` and `LabelDetail` must precede `LabelPopup`).

### Exercising routes over HTTP

`WebFetch` cannot reach `localhost`, so use `curl` via the Bash tool. Most routes require authentication, so grab an anonymous session cookie once, then reuse the cookie jar:

```bash
# one-time per conversation: get an anonymous session cookie
curl -s -c /tmp/sidewalk_cookies.txt "http://localhost:9000/anonSignUp?url=%2F"
# authenticated request: pass the cookie jar with -b
curl -s -b /tmp/sidewalk_cookies.txt "http://localhost:9000/v3/api/labelTypes"
```

The cookie persists for the shell session; re-run `anonSignUp` at the start of each new conversation for a fresh one.

### Inspecting the database

To understand the schema, query the live DB directly rather than reading through evolutions. Use the **read-only** `readonly_user` role (only SELECT privileges — never `-U sidewalk`, to avoid accidental writes):

```bash
docker exec projectsidewalk-db psql -U readonly_user -d sidewalk -c "\dt sidewalk_seattle.*"
docker exec projectsidewalk-db psql -U readonly_user -d sidewalk -c "SELECT * FROM sidewalk_login.role;"
```

Each city has its own schema (`sidewalk_<city>`), and they are essentially identical — `sidewalk_seattle` is a safe default for schema questions; authentication lives in `sidewalk_login`. If you need to query *actual data* (not just structure), **ask which city we're working in first**. Evolutions in `conf/evolutions/default/` are auto-applied when a page loads, so you don't run them manually.

**The dev DB is not representative of production size, and some tables may be absent.** The two largest production tables by a wide margin are **`audit_task_interaction`** and **`validation_task_interaction`** (raw per-action interaction logs — pans, zooms, clicks). The dev DB dumps that seed local development **omit** these tables to stay manageable, so locally they are typically empty or missing. Never infer a table's production size or existence from the local DB. When reasoning about query cost or indexes, treat these two interaction tables — not `webpage_activity` — as the heavyweight logs.

### Linting

```bash
make lint           # eslint + htmlhint + stylelint -- not ready for user yet, only eslint is ready (#2487)
make lint-fix       # eslint --fix + stylelint --fix -- not ready for user yet, only eslint is ready (#2487)
make eslint         # defaults to public/javascripts/ (build/ + lib/ carved out by eslint.config.js ignores)
make eslint dir=public/javascripts/SVValidate   # scope to a dir or file; also htmlhint / stylelint targets
```

**`make eslint` must pass (zero errors/warnings) before code is checked in** — like scalafmt for Scala. The tree is
fully lint-clean (#2487), so a bare run should come back green and any finding is yours: run
`make eslint-fix dir=<what you touched>` for the mechanical fixes, hand-fix the rest, then confirm with `make eslint`.
ESLint is now a **blocking CI gate** (a step in the `frontend` job, `npx eslint public/javascripts/`), so an `error`
finding fails the build — the JS counterpart to scalafmt. Severities are the gate: nearly every rule is `error`; the
one `warn` rule (`max-len`) is deliberately advisory (CLAUDE.md permits long-line exceptions), so CI runs without
`--max-warnings 0` and an over-limit line nags but doesn't block. `htmlhint`/`stylelint` are still manual and not in CI
(their trees aren't clean yet — #2487).

These are run **from the host** (like `make scalafmt`): the targets `docker exec` into the running web container,
where the linters' `node_modules` live (there is no host-side `npm install`), so the web container must be up. Scope a
run with `dir=` and pass extra flags with `args=`.

Config: `eslint.config.js`, `.stylelintrc.json`, `.htmlhintrc`. Scala formatting is `.scalafmt.conf`.

### What not to automate

Do **not** attempt live or browser-automated testing of anything that requires viewing or interacting with a GSV (street-view) panorama — placing labels in Explore, validating in Validate, etc. The developer tests those visually. Instead, hand them a short checklist of things to verify or a console snippet to run while reproducing the issue.
