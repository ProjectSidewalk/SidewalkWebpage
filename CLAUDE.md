# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Project Sidewalk is a web-based crowdsourcing tool for mapping and assessing sidewalk accessibility. The backend is **Scala + Play Framework 3.0** (Scala 2.13, Java 17) with a **Postgres + PostGIS** database accessed via **Slick** (with slick-pg for spatial/JSON types). The frontend is **vanilla JavaScript**, organized as several independent apps that are bundled with **Grunt** (concatenation only — no transpilation/minification). Everything runs in **Docker** for development.

## Backend architecture

Request flow: **routes → Controller → Service → Table (DAO)**.

- **`conf/routes`** — single routes file mapping URLs to controller methods. The public data API lives under `/v3/api/...` (handlers in `app/controllers/api/`).
  - **v3 API naming convention (issue #3871):** query/REST **parameters are camelCase** (`minSeverity`, `regionId`, `validationStatus`); **all output field names are snake_case** — JSON bodies, GeoJSON `properties`, CSV headers, and shapefile/geopackage fields (`label_id`, `region_name`, `city_id`). One canonical field name across every export format. For macro serializers, use a scoped `JsonConfiguration(JsonNaming.SnakeCase)` so `Json.format`/`Json.writes` emit snake_case. `ApiError.parameter` names a query param, so it stays camelCase. v3 is a **preview** surface: breaking changes are made in place rather than minting a new version (precedent: #4223).
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

**Known exception**: the older `/v2` access-score DTOs (`StreetScore`, `RegionScore` in `models/computation/`,
`ClusterForApi` in `models/cluster/`) intentionally remain in place pending the v3 access-score rewrite (#3855) and v2
removal (#3864). `app/formats/json/ApiFormats.scala` holds their serializers plus other non-DTO writes; new API DTOs
should not add to it.

### Database & evolutions

Schema changes are **Play evolutions**: numbered SQL files in `conf/evolutions/default/`. Add the next-numbered file for schema changes; each has `# --- !Ups` and `# --- !Downs` sections. The dev DB is seeded from a dump — see the wiki and `db/scripts/` (`import-dump`, `create-new-schema`, etc., exposed as `make` targets). Connection config is env-driven (`DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD`) in `conf/application.conf`.

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

## Configuration

- `conf/application.conf` is the base; environment overlays are `application.local.conf`, `application.staging.conf`, `application.test.conf`. `npm start` runs with `application.local.conf`.
- Per-city settings: `conf/cityparams.conf` (selected via `SIDEWALK_CITY_ID`). Many secrets/keys come from env vars (Mapbox, Google Maps, Gemini, Mapillary, Infra3d, Silhouette signer/crypter); dev defaults are dummy values in `docker-compose.yml`, with real local values in `docker-compose.override.yml` (hidden from Claude, ask if you need to know something like the city-id).

## Python utilities

Two standalone scripts (run via the Python deps in `requirements.txt`, installed in the Docker image), invoked out-of-band rather than from the running web app:

- `label_clustering.py` — clusters nearby labels (used by the clustering flow; see `ClusterController.scala` / `app/models/cluster/`).
- `check_streets_for_imagery.py` — checks streets for available street-view imagery (related: `make hide-streets-without-imagery`).

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

## Development Guidelines
- Main development branch is **develop**; **master** is the release branch. PRs target `develop`.
- If there is an associated Github issue, beging the branch name with the issue number (e.g. `1234-fix-label-popup`).
- When changing JS behavior, edit `src/` and let `grunt watch` rebuild; if a new `src/` file isn't picked up, check that its path matches a glob in `Gruntfile.js`.
- When updating code in JavaScript, migrate that code to ECMA6 (`let`/`const` instead of `var`, etc.).
- When refactoring a JS constructor function (the `function Foo(...) { const self = this; ... return self; }` pattern), convert it to an ES6 `class`. Use `#` private fields/methods. Use arrow functions in event listeners to keep `this` bound correctly.
- Update said code to use the native `fetch` API rather than jQuery, and to make use of Promises. But if said refactor would impact many other functions that use it, then wait for a dedicated refactor.
- Replace uses of Bootstrap with native JS alternatives as you come across them
- When writing SQL, avoid table aliases
- Ensure WCAG 2.1/2.2 Level AA accessibility standards are met
- When adding or refactoring code, use the fonts, colors, button styling, etc. defined in main.css :root. These are pulled from our "Design System Tokens" Figma, and we are pushing to use these going forward.
- Max line length of 120 characters, with long line exceptions where appropriate. For multi-line comments, TARGET line length is 120 characters

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

Use `/** ... */` for all JSDoc. Every ES6 class and every non-trivial method gets one — including `#private` methods.
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

**ES6 class:**
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
- Do not describe what the code *used to* do — use git history for that.
- Do not leave `TODO`/`FIXME` in committed code without a linked tracking issue.
- Do not add a header just because a function was touched; only add one if it is missing
  and the function is non-trivial.

## Linting Rules (will be enforced by `make lint` some day, but not being run now)
- ESLint: ES6+, `const`/`let` only (no `var`), arrow functions, template literals, semicolons required, 120-char line limit
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

Inside the web container shell, the developer starts the app with `npm start` (runs Grunt concat + watch in the background, then `sbt run` — i.e. `sbt ~ run`, continuous recompile; `npm run debug` adds a JVM debug port). It serves on **http://localhost:9000** using `conf/application.local.conf`. First compile is slow (sbt resolves dependencies); sbt keeps its caches inside the project dir (`.coursier`, `.sbt`).

### Verifying backend (Scala) changes compile

There is **no Scala/backend test suite** — validate backend changes by compiling. The clean way is the **sbt thin client**, which runs against its own dedicated server and so does *not* fight the developer's running `sbt ~ run` (a plain second `sbt compile` collides with it over build/target locks and hangs):

```bash
docker exec projectsidewalk-web bash -lc "cd /home && sbt --client compile"
```

- First call per container boot is ~30s (it starts the dedicated compile server); every call after is near-instant (warm server reuse).
- It compiles whatever is **saved on disk**, so it reflects uncommitted edits. `build.sbt` sets `-Xfatal-warnings`, so a `[success]` means warning-clean too (unused imports/params, dead code, value discard all fail the build).
- It only needs the web container up — the app itself (`npm start`) does not have to be running.

Alternatively, since the developer's `sbt ~ run` recompiles on save, hitting any route over HTTP (see below) also forces a compile; errors surface as a 500 page rather than clean output, so prefer the thin client when you just want a pass/fail.

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

### Linting (do not run these now, future refactor will set this up)

```bash
make lint           # eslint + htmlhint + stylelint
make lint-fix       # eslint --fix + stylelint --fix
make eslint dir=public/javascripts/SVValidate   # scope to a dir; also htmlhint / stylelint targets
```

Config: `.eslintrc.json`, `.stylelintrc.json`, `.htmlhintrc`. Scala formatting is `.scalafmt.conf`.

### What not to automate

Do **not** attempt live or browser-automated testing of anything that requires viewing or interacting with a GSV (street-view) panorama — placing labels in Explore, validating in Validate, etc. The developer tests those visually. Instead, hand them a short checklist of things to verify or a console snippet to run while reproducing the issue.
