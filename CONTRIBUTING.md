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
2. Skim [`CLAUDE.md`](CLAUDE.md) — it's written for an AI assistant but is the most complete, current tour of the
   architecture, conventions, and build/test commands.
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

The full conventions live in [`CLAUDE.md`](CLAUDE.md) (architecture + ScalaDoc/JSDoc comment standards); a dedicated
`docs/style-guide.md` is planned. The essentials:

**General**
- Max line length **120 characters** (with sensible exceptions for readability).
- Indent with **spaces**, not tabs; end every file with a newline.
- Comments start with a capital letter and end with a period, and explain **why**, not what.
- Meet **WCAG 2.1/2.2 Level AA** for any UI work, and use the design-system tokens in `main.css` `:root` for fonts,
  colors, and buttons.

**JavaScript** (vanilla JS, concatenated by Grunt — no module system)
- Write **ES6+** for new and modernized code: `const`/`let` (never `var`), arrow functions, template literals,
  semicolons. When editing an old all-ES5 file, you may match its style, but prefer modernizing.
- Use single quotes for strings (backticks for interpolation/multiline).
- Prefer native **`fetch`** + Promises over jQuery, and native JS/CSS over Bootstrap, as you touch that code.
- When refactoring an old constructor-function module, convert it to an ES6 `class` with `#private` fields.

**Scala** (Play 3.0, Scala 2.13)
- Follow the request flow **routes → Controller → Service → Table (DAO)**; keep controllers thin.
- Declare value types where it aids clarity (e.g. `val x: Int = 5`), using discretion for long/obvious library
  types.
- Use **Slick** for queries rather than raw SQL; when you do write SQL, avoid table aliases. Format with
  **scalafmt** (`.scalafmt.conf`).
- Two performance gotchas: count rows with `.size.result` (a `COUNT(*)`), **not** `.length.result` (loads all rows
  into memory); for CPU-heavy work, use the `cpu-intensive` `ExecutionContext` (see existing examples) rather than
  the default.

**Public API (`/v3`)** — output field names are **snake_case**; query/REST parameters are **camelCase**. New API
DTOs go in `app/models/api/`. See the API sections of [`CLAUDE.md`](CLAUDE.md).

## Internationalization

User-facing text must be translatable. There are two systems:

- **Backend (server-rendered):** Play message files `conf/messages.<lang>` (`messages.en`, `messages.es`, …).
  Add a key to each language file and reference it in `.scala.html` with `@Messages("your.key")`.
- **Frontend (client-side):** JSON under `public/locales/<lang>/` (e.g. `common.json`). Reference it with
  `i18next.t('your-key')`, or prefer `data-i18n="ns:key"` directly in HTML to avoid duplicate strings.

Supported languages: **en, es, de, nl, zh-TW, pt-BR**, plus the regional English variants **en-US** and **en-NZ**.

**When you add or change user-facing text:**

1. Add **temporary translations** for Spanish, Dutch, German, and Mandarin (`zh-TW`, traditional). Google Translate
   is fine for these — a maintainer periodically sends the accumulated machine translations to our partners for
   official ones.
2. Add to the generic **`en`** files by default. Also add **regional overrides** only where the wording differs:
   - **en-US** — distances use feet/miles (`ft`/`mi`) where generic `en` uses meters/kilometers (`m`/`km`); your
     code should respect the unit system too (see existing examples).
   - **en-NZ** — e.g. curb ramp → *drop kerb*, sidewalk → *footpath*, crosswalk → *pedestrian crossing*,
     neighborhood → *neighbourhood*, organization → *organisation*, meter/kilometer → *metre/kilometre*,
     trash/recycling can → *trash/recycling bin*.

**When you remove translated text,** check it isn't used elsewhere; if not, remove the key from every language file.

## Testing your changes

There is no automated backend test suite yet (see [`docs/testing-and-ci.md`](docs/testing-and-ci.md)) — validate
backend changes by compiling (`sbt --client compile`; see [`docs/dev-environment.md`](docs/dev-environment.md)), and
exercise behavior in the running app.

**Update logging.** User interactions (clicks, key presses, etc.) should be logged. If you add or change
interactions, update the logging accordingly.

**Test as the relevant user types.** Behavior often differs by role:

- **Anonymous** — the default on first visit; an incognito/private window gives you a fresh anon account.
- **Registered** — create an account and sign in.
- **Administrator** — promote an account locally by setting its role to Administrator (role `4`):

  ```sql
  -- find your user_id, then promote it
  SELECT user_id FROM sidewalk_login.sidewalk_user WHERE username = '<your-username>';
  UPDATE sidewalk_login.user_role SET role_id = 4 WHERE user_id = '<your-user-id>';
  ```

- **Mechanical Turk worker** — visit
  `localhost:9000/?referrer=mturk&hitId=h1&workerId=worker1&assignmentId=a1&minutes=60`. To start a fresh turker,
  change `workerId`/`hitId`/`assignmentId`.

**Test on mobile if you touched the Validate page** (the only page served on mobile). Start with Chrome DevTools
[device mode](https://developer.chrome.com/docs/devtools/device-mode/); if it looks good, test on a real device by
visiting `<your-computer-ip>:9000` (phone and computer on the same Wi-Fi; this often fails on public/café networks).

## Submitting a pull request

1. Merge the latest `develop` (`git pull origin develop`) and test one more time.
2. **Run scalafmt** on any Scala files you changed (IntelliJ: `Ctrl`+`Alt`+`L`; VS Code via the Metals/Scalafmt
   formatter — both can format-on-save). CI also checks formatting.
3. Push your branch and [open a PR](https://github.com/ProjectSidewalk/SidewalkWebpage/compare) with **base
   `develop`** ← your branch. Fill out the [PR template](.github/PULL_REQUEST_TEMPLATE.md): clear title, description,
   before/after screenshots for UI, testing instructions, translations, and logging updates. Link the issue
   (`Resolves #474`).
4. **Keep PRs small** and scoped to one issue.
5. A maintainer (usually Mikey) will review. Address feedback in follow-up commits, then leave a comment letting us
   know it's ready for another look. Once approved, we merge to `develop` (and eventually `master`).

## Where documentation lives

- **In this repo:** [`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), [`SECURITY.md`](SECURITY.md),
  [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), [`CLAUDE.md`](CLAUDE.md), and guides under [`docs/`](docs/).
- **In the [wiki](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki):** operational runbooks, city-deployment
  guidance, and visual/GIS tutorials.

If you change behavior a doc describes, update the doc in the same PR.

## Questions

Open an issue, ask in the team Slack (**#core** / **#interns**), or email **sidewalk@cs.uw.edu**. We're glad you're
here. 🎉
