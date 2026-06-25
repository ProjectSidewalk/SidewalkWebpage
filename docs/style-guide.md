# Code style guide

This is the detailed style reference for Project Sidewalk. [`CONTRIBUTING.md`](../CONTRIBUTING.md) lists the
day-to-day essentials and links here for the full conventions; [`CLAUDE.md`](../CLAUDE.md) holds the architecture and
the ScalaDoc/JSDoc comment standards. This page explains the conventions a linter can't, and the *why* behind the
ones it can.

**The linters are the source of truth for mechanically-checkable rules.** JavaScript/CSS/HTML rules live in
[`.eslintrc.json`](../.eslintrc.json), [`.stylelintrc.json`](../.stylelintrc.json), and
[`.htmlhintrc`](../.htmlhintrc); Scala formatting lives in [`.scalafmt.conf`](../.scalafmt.conf). When this guide and a
config disagree, the config wins — fix the config and this doc together. (Frontend linting isn't wired into CI yet —
it's sequenced with the ES5→ES6 migration, [#2487](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2487) —
but the rules already describe the standard we write to. `scalafmtCheckAll` *does* run in CI, as advisory.)

## General

These apply across every language in the repo.

- **Line length: 120 characters max**, with sensible exceptions where a break would hurt readability (e.g. long
  URLs, string literals). For multi-line comments, treat 120 as a target, not a hard cap.
- **Indent with spaces, never tabs.** Scala/JS use 2-space indent; CSS uses 4-space (`stylelint-config-standard`).
- **End every file with a single newline.** A missing final newline shows up as a red marker on the GitHub diff.
- **Comments explain _why_, not _what_** — well-named identifiers cover the *what*. Start a comment with a capital
  letter and end it with a period:

  ```js
  // This is the correct style.
  //this is incorrect
  ```

- **Accessibility is part of style.** Any UI work must meet **WCAG 2.1/2.2 Level AA**. Pull fonts, colors, spacing,
  and button styles from the design-system tokens in `main.css` `:root` rather than hardcoding values — these come
  from our Figma "Design System Tokens" and are what we're standardizing on.
- **Write descriptive commit messages** that say what actually changed and why. `Fixes #880`, `Addresses PR
  feedback`, and `Update ModalMissionComplete.js` are all too vague to be useful in `git log` later.

## JavaScript

The frontend is vanilla ES, organized as independent apps that Grunt concatenates (no transpiler, no module system).
Edit files under `src/`; never edit the generated `build/` bundles. Most rules below are enforced by
[`.eslintrc.json`](../.eslintrc.json).

- **Write ES6+ for new and modernized code:** `const`/`let` (`no-var`), arrow functions, template literals
  (`prefer-template`), object shorthand, and `===`/`!==` (`eqeqeq`). When you're editing a file that is *entirely*
  ES5, you may match its style for consistency — but prefer modernizing it. See the migration guidance in
  [`CLAUDE.md`](../CLAUDE.md) (constructor-functions → ES6 `class` with `#private` fields; jQuery → native `fetch`;
  Bootstrap → native JS/CSS as you touch that code).
- **One declaration per statement** (`one-var: never`) — the opposite of the old comma-chained `var` style:

  ```js
  const width = 640;
  const height = 480;
  ```

- **Single quotes** for string literals (`quotes: single`); use backticks when you need interpolation or multi-line
  strings.
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

- **Document with JSDoc** (`/** ... */`) on every ES6 class and non-trivial method, including `#private` ones — type
  annotations matter because there's no static checker. Full template and rules in [`CLAUDE.md`](../CLAUDE.md).

## HTML / CSS

- **Style in CSS files, not inline** on elements. The exception is styling that genuinely has to be computed at
  runtime in JavaScript.
- **HTML attributes: no spaces around `=`** (`attr="value"`, not `attr = "value"`) — the one place we *don't* space
  around `=`. Lowercase tags and attributes, double-quoted attribute values, `alt` text on images
  ([`.htmlhintrc`](../.htmlhintrc)).
- **Prefer `data-i18n="ns:key"`** in HTML over hardcoded strings so translations stay in i18next and aren't
  duplicated (see [`CONTRIBUTING.md`](../CONTRIBUTING.md) → Internationalization).
- **CSS:** 4-space indent, `stylelint-config-standard` ([`.stylelintrc.json`](../.stylelintrc.json)). Use the
  `main.css` `:root` design tokens for colors/fonts/spacing.

## Scala

Formatting is handled by **scalafmt** ([`.scalafmt.conf`](../.scalafmt.conf)) — run it before pushing (CI checks it
as advisory). Conventions scalafmt doesn't cover:

- **Follow the request flow** `routes → Controller → Service → Table (DAO)`; keep controllers thin and put business
  logic in services. (See [`CLAUDE.md`](../CLAUDE.md) / [`docs/architecture.md`](architecture.md).)
- **Declare value types where it aids clarity** — prefer `val x: Int = 5` over `val x = 5`. Use discretion when the
  type is long/uninformative (often the case with Slick types) or when an explicit annotation would push a line past
  120 chars or hurt readability.
- **Use Slick for database access**, not raw SQL, wherever possible — you get compile-time type checking. When you
  must write SQL, **avoid table aliases**.
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
