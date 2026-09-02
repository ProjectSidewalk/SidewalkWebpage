# Contributing to Project Sidewalk

Thanks for your interest in contributing! Project Sidewalk is an open-source tool for mapping and assessing sidewalk
accessibility, and we welcome bug reports, fixes, features, translations, and documentation improvements.

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug or request a feature** — open a [GitHub issue](https://github.com/ProjectSidewalk/SidewalkWebpage/issues).
  Search first to avoid duplicates, and include steps to reproduce, your environment, and screenshots where helpful.
- **Report a security vulnerability** — *don't* open a public issue; follow [`SECURITY.md`](SECURITY.md).
- **Fix a bug or build a feature** — see the [workflow](#development-workflow) below.
- **Improve translations** — Project Sidewalk runs in many languages; see [Internationalization](#internationalization).

## Before you start

1. Set up your local environment by following [`docs/dev-environment.md`](docs/dev-environment.md).
2. Skim [`docs/architecture.md`](docs/architecture.md) for the tour of the codebase, and
   [`docs/style-guide.md`](docs/style-guide.md) for the conventions.
3. **Claim an issue.** Pick an [open issue](https://github.com/ProjectSidewalk/SidewalkWebpage/issues) and comment
   that you're working on it. For anything non-trivial, agree on the approach in the issue thread *before* you write
   code — and for UI changes, post before/after mockups there first (the PR thread is for implementation details).

## Development workflow

We use a branch-and-pull-request model. **Always branch off `develop`**, never `master`.

- **`develop`** — the active development branch and the target for every pull request.
- **`master`** — the release branch, deployed to production ([projectsidewalk.io](https://projectsidewalk.io)).
  Don't branch from it or target it.

### 1. Create a branch

Name it `<issue-number>-<brief-description>` — e.g. for issue #474, `474-admin-update-activities-table`. **Don't**
prefix with `#` (it breaks command-line autocomplete).

```bash
git checkout develop
git pull                                   # get the latest develop
git checkout -b 474-admin-update-activities-table
git push --set-upstream origin 474-admin-update-activities-table
```

### 2. Write code

Follow the [coding standards](#coding-standards). As you work:

- **Review changes file by file before committing.** Don't `git commit -a` or `git commit .` — it's the easiest way
  to commit debugging scaffolding by accident. Instead:

  ```bash
  git status                 # what changed?
  git diff path/to/file      # confirm each file contains only intended changes
  git add path/to/file       # stage it
  git commit -m "Add severity filter to the admin activities table"
  git push
  ```

- **Write descriptive commit messages** that say what actually changed. Avoid vague messages like `Fixes #880`,
  `Addresses PR feedback`, or `Update ModalMissionComplete.js`.

### 3. Keep your branch current

Before opening a PR — and before re-requesting review after changes — merge the latest `develop` and re-test:

```bash
git pull origin develop
```

## Coding standards

Code-style conventions for JavaScript, Scala, and HTML/CSS live in **[`docs/style-guide.md`](docs/style-guide.md)** —
that's the single source of truth, and most rules are enforced for you by the linters
([`eslint.config.js`](eslint.config.js), [`.scalafmt.conf`](.scalafmt.conf), [`stylelint.config.mjs`](stylelint.config.mjs)).
[`docs/architecture.md`](docs/architecture.md) holds the architecture. A few things worth knowing before your first
PR:

- **New JavaScript targets ES2022** (`const`/`let`, arrow functions, `#private` fields, native `fetch`). We're
  actively migrating *off* ES5/jQuery/Bootstrap — don't add to them.
- **Format Scala with scalafmt** before pushing (`make scalafmt-fix`, or format-on-save) — CI blocks the merge on it.
- **Keep the frontend linters passing on what you change** before pushing. Run `make lint-fix` for the mechanical
  ESLint/Stylelint fixes, hand-fix the rest, then confirm the relevant linter is clean — `make eslint` (JS + translation
  JSON), `make stylelint` (CSS), `make htmlhint` (HTML), `make lint-locales` (cross-locale key parity),
  `make lint-css-layout` (the `public/css/` layout), `make lint-asset-paths` (asset URLs in `public/js/`), or
  `make lint` for all of them (it also runs the evolutions lint). The trees are kept fully lint-clean
  ([#2487](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2487)), so any finding is from your change.
  **All of them are blocking CI checks** now (they run in the `Frontend (build)` job), so a lint failure blocks the
  merge — just like scalafmt.
- **UI work** must meet WCAG 2.1/2.2 Level AA and use the `main.css` `:root` design tokens — type via the composite
  `--text-*` tokens (see the [style guide](docs/style-guide.md)). The target, the axe-core gate in the browser suite,
  and the manual checklist are in **[`docs/accessibility.md`](docs/accessibility.md)**.
- **Public API (`/v3`):** response fields are `snake_case`, query params are `camelCase`, and new DTOs go in
  `app/models/api/`.
- **Don't hardcode backend values in the frontend.** Domain values — enums, ranges (min/max), thresholds, and
  especially the *mappings* between them (e.g. severity → `good`/`ok`/`bad`, which runs in opposite directions
  for positive vs. negative access features) — come from the backend (a `/v3/api/...` endpoint or a value
  injected into the view), not literals in JS, so the two can't drift. See [`CLAUDE.md`](CLAUDE.md).

See [`docs/style-guide.md`](docs/style-guide.md) for the full rules, including the request-flow and Slick/SQL
conventions, and [`docs/evolutions.md`](docs/evolutions.md) before writing a schema change.

## Internationalization

**All user-facing text must be translatable** — never hardcode display strings. Project Sidewalk has two i18n systems
(backend Play messages in `conf/messages/`, and frontend i18next JSON in `public/locales/`), supports several
languages, and has specific rules for temporary translations and the `en-US`/`en-NZ` regional variants.

The full details — both systems, adding/changing/removing text, and adding a whole new language — are in
**[`docs/internationalization.md`](docs/internationalization.md)**. The one thing to remember: when you add or change
user-facing text, add at least temporary (machine) translations for the other languages in the same PR.

## Testing your changes

There's a backend test suite (ScalaTest) under `test/` — mainly public-API functional specs. Run it with
`sbt --client test` (the DB-backed API specs boot the app against Postgres+PostGIS, so the `db` container must be
up); the overall strategy and phased rollout are in [`docs/testing-and-ci.md`](docs/testing-and-ci.md). CI runs the
whole suite as a blocking, required check — a new spec is picked up by existing, with nothing to enroll it in — but
coverage is still thin, so also compile (`sbt --client compile`) and exercise behavior in the running app. See
[`docs/dev-environment.md`](docs/dev-environment.md) for the exact commands.

**Update logging.** User interactions (clicks, key presses, etc.) should be logged. If you add or change
interactions, update the logging accordingly.

**Test as the relevant user types.** Behavior often differs by role:

- **Anonymous** — the default on first visit; an incognito/private window gives you a fresh anon account.
- **Registered** — create an account and sign in.
- **Administrator** — promote an account locally by setting its role to Administrator:

  ```sql
  -- find your user_id, then promote it
  SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = '<your-username>';
  UPDATE sidewalk_login.user_role SET role = 'Administrator' WHERE user_id = '<your-user-id>';
  ```

- **Mechanical Turk worker** — visit
  `localhost:9000/?referrer=mturk&hitId=h1&workerId=worker1&assignmentId=a1&minutes=60`. To start a fresh turker,
  change `workerId`/`hitId`/`assignmentId`.

**Test on mobile if you touched the Validate page or the auth pages** — the pages mobile visitors are actually
served (`/mobileLanding`, the mobile Validate page at `/mobile`, and the sign-in/sign-up flow; every other page
redirects them to `/mobileLanding`). Start with Chrome DevTools
[device mode](https://developer.chrome.com/docs/devtools/device-mode/); if it looks good, test on a real device by
visiting `<your-computer-ip>:9000` (phone and computer on the same Wi-Fi; this often fails on public/café networks).

## Submitting a pull request

1. Merge the latest `develop` (`git pull origin develop`) and test one more time.
2. **Run scalafmt** on any Scala files you changed — `make scalafmt-fix` (CI blocks the merge on formatting). Set up
   format-on-save once via [`docs/editor-setup.md`](docs/editor-setup.md) so this is automatic. Likewise **run the
   frontend linters** on anything you changed — `make lint` (or the specific `make eslint`/`stylelint`/`htmlhint`/
   `lint-locales`/`lint-css-layout`/`lint-asset-paths` target), with `make lint-fix` for the mechanical fixes. They're all blocking CI checks now, so a lint
   failure blocks the merge; the trees are kept lint-clean —
   [#2487](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2487).
3. Push your branch and [open a PR](https://github.com/ProjectSidewalk/SidewalkWebpage/compare) with **base
   `develop`** ← your branch. Fill out the [PR template](.github/PULL_REQUEST_TEMPLATE.md): clear title, description,
   before/after screenshots for UI, testing instructions, translations, and logging updates. Link the issue
   (`Resolves #474`).
4. **Keep PRs small** and scoped to one issue.
5. A maintainer (usually Mikey) reviews external contributions; core maintainers may self-merge their own work.
   Address feedback in follow-up commits, then leave a comment letting us know it's ready for another look. Once the
   required checks are green, merge to `develop` (and eventually `master`).

### Merge requirements (branch protection)

`develop` is branch-protected so a red build can't land (the failure mode that once shipped a migration that wouldn't
apply). A PR can only merge once the **blocking CI checks pass** — **`Backend (compile + scalafmt)`**,
**`Frontend (build)`** (which also runs ESLint, Stylelint, HTMLHint, locale key-parity, the CSS layout check and the
asset-path check, so any frontend lint failure blocks the merge), **`Route reachability lint`**, **`Evolutions lint`**,
**`Backend tests (API, PostGIS)`** and **`Python tests (in-band script)`**. The rule:

- **Applies to everyone, maintainers included** — there is no admin bypass; it only ever stops a merge while CI is red.
  It also means nobody pushes straight to `develop`: a direct push has no PR for the checks to run against.
- **Does not require review approvals.** Tooling won't force a second person to sign off, so you can still open and
  merge your own PR. Review is by convention (and expected for external contributions), not enforced by a gate.
- **Coverage can block too.** `Backend tests (API, PostGIS)` ends on a statement-coverage ratchet, so removing tests
  can fail the build even when everything still passes. The JS suite reports coverage but has no floor yet (#5112).
- **Advisory jobs never block.** `E2E smoke (Playwright)` and `Python tests (offline tooling)` report status but are
  not required checks.

Full gating policy and rationale: [`docs/testing-and-ci.md`](docs/testing-and-ci.md).

## Where documentation lives

- **In this repo:** [`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md),
  [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), [`CLAUDE.md`](CLAUDE.md), and guides under [`docs/`](docs/).
- **In the [wiki](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki):** operational runbooks, city-deployment
  guidance, and visual/GIS tutorials.

If you change behavior a doc describes, update the doc in the same PR.

## Questions

Open an issue, ask in the team Slack (**#core** / **#interns**), or email **sidewalk@cs.uw.edu**. We're glad you're
here. 🎉
