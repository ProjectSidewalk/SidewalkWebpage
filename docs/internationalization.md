# Internationalization (i18n)

Project Sidewalk is translated into several languages, and **all user-facing text must be translatable** — never
hardcode display strings. This page is the single home for how i18n works, how to add or change translated text, and
how to add a whole new language.

## Supported languages

`en` (default), `es`, `nl`, `de`, `pt-BR`, `zh-TW`, plus the regional English variants `en-US` and `en-NZ`. The
authoritative list is **`play.i18n.langs`** in [`conf/application.conf`](../conf/application.conf) — that's what
determines the languages the app offers.

## The two i18n systems

Project Sidewalk has two separate translation systems; which one you use depends on where the string is rendered.

### Backend — Play i18n (server-rendered Twirl templates)

- Message files live in **`conf/messages/`**: `messages` (default) and `messages.<lang>` per language
  (`messages.en`, `messages.es`, `messages.de`, `messages.zh-TW`, …). City-specific overrides exist too
  (e.g. `messages-india.en`). The directory is wired via `play.i18n.path = "messages"` in `conf/application.conf`.
- Add a key to the relevant message file(s) and reference it in a `.scala.html` template with `@Messages("your.key")`
  (or the injected `messagesApi`).

> **English lives in `messages.en`, not the base `messages`.** New English strings go in **`conf/messages/messages.en`**,
> with a translation added to **every** `messages.<lang>`. The suffix-less **`conf/messages/messages`** is Play's
> *default/fallback* file: reserve it for genuinely language-neutral values (city-name proper nouns, way-type keys) and
> never put translatable English prose there.
>
> **Why this is easy to get wrong:** the base `messages` looks like "the English/default file," so an English-only first
> pass tends to land there — and then the later translation pass adds `messages.en` + each `messages.<lang>`, leaving a
> stale duplicate English copy in the base file. Do the English-only first pass **in `messages.en`** from the start.
>
> Fallback resolution matters here: `en-US`/`en-NZ` fall back through `messages.en` (so they inherit English there), but
> the non-English languages fall back straight to the base `messages` default — they do **not** fall back through
> `messages.en` — so a key missing from a `messages.<lang>` file surfaces as the raw key. That's why every language file
> must carry every key (and why the base default should not be treated as an English safety net). Note there is **no**
> automated parity check for the backend message files the way there is for the frontend JSON (see below), so this is on
> you to keep complete.

> **Escape a literal apostrophe as `''` (two single quotes).** Play renders every message through
> `java.text.MessageFormat`, which treats a single `'` as a quoting character and silently drops it — **even in messages
> with no `{0}` placeholders.** So `We're` renders as `Were`, and quotation marks like `'Unsure'` render as `Unsure`
> (text kept, quotes gone). Write the apostrophe doubled — `We''re`, `Why ''Unsure''?` — and MessageFormat collapses each
> `''` back to a single `'`. There is no linter for this, so grep a new/edited message file for un-doubled apostrophes
> before committing (a lone `'` is almost always the bug).

### Frontend — i18next (client-side JavaScript)

- Translations live in **`public/locales/<lang>/<namespace>.json`**, split into namespaces such as `common.json`,
  `audit.json`, `gallery.json`, `dashboard.json`, `routebuilder.json`, and `labelmap.json` (plus city-specific
  variants like `common-india.json`, `audit-zurich.json`).
- Reference a string with `i18next.t('namespace:your-key')`, **or prefer `data-i18n="namespace:key"` directly in the
  HTML** — that keeps the translation in i18next and avoids duplicating strings across JS and markup.

> Most user-facing text in the apps is in the **frontend** system. Reach for the backend message files only for
> server-rendered Twirl pages.

## Adding or changing user-facing text

1. **Add the key** to the appropriate backend message file or frontend namespace JSON, for the languages you can. For
   backend keys, the English goes in **`messages.en`** (never the base `messages` — see the callout above).
2. **Add temporary machine translations** for Spanish, Dutch, German, and Mandarin (`zh-TW`, traditional) — Google
   Translate is fine. A maintainer periodically sends the accumulated machine translations to our partners for proper
   ones, so don't block on official translations.
3. **Default to the generic `en`** files, and add **regional English overrides only where the wording actually
   differs**:
   - **`en-US`** — imperial units: feet/miles (`ft`/`mi`) where generic `en` uses metric (`m`/`km`). Your code must
     respect the unit system too (see existing examples).
   - **`en-NZ`** — dialect: curb ramp → *drop kerb*, sidewalk → *footpath*, crosswalk → *pedestrian crossing*,
     neighborhood → *neighbourhood*, organization → *organisation*, meter/kilometre → *metre/kilometre*,
     trash/recycling can → *trash/recycling bin*.
4. **Prefer `data-i18n` in HTML** over duplicating a string in both a template and JS.

**Removing translated text:** confirm the key isn't used elsewhere, then remove it from **every** language file so no
orphans remain.

## Adding a whole new language

1. **Get translations.** Hand the translator the English source as the starting point: `conf/messages/messages.en`
   (backend) and `public/locales/en/*.json` (frontend).
   - Ask them **not to edit the keys** — only the values. (Especially important for non-technical partners.)
   - For a **regional variant** of a language we already have (as with `en-NZ` over `en`), it's cleaner to ask them
     to keep only the lines that actually change.
2. **Register the locale** by adding it to `play.i18n.langs` in [`conf/application.conf`](../conf/application.conf).
3. **Add the translated files:** backend as `conf/messages/messages.<lang>`, frontend as
   `public/locales/<lang>/<namespace>.json` (mirror the namespaces in `public/locales/en/`).
4. **Add the moment.js locale** (for localized dates) if one exists for the language: drop the locale file into
   `public/vendor/moment/` and add a `<script>` import in
   [`app/views/common/main.scala.html`](../app/views/common/main.scala.html) alongside the existing per-locale imports
   (`es.js`, `nl.js`, `zh-tw.js`, `en-nz.js`). We import locales individually to keep the bundle small. (There's an
   open ticket, [#1258](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1258), about moving off moment.js —
   don't take that on as part of adding a language.)
5. **Mind the `unit-distance` key.** In `common.json`, `unit-distance` (e.g. `"kilometers"` / `"miles"`) is **not**
   display text — it's a unit-*system* selector consumed by turf.js. For a new non-US language, leave it as
   `"kilometers"` (metric) rather than translating the word.
6. **Test thoroughly.** Compare each main page against the English version (open them in adjacent tabs and flip
   between them) to catch layout breakage from differing text lengths. On Explore, place a label of each type and
   open the various sub-menus. Then open a PR and deploy to the test servers so the requesting partner can review the
   live result.

## Linting the translation files

The frontend i18next JSON under `public/locales/` is linted in CI (blocking steps in the `frontend` job — see
[`docs/testing-and-ci.md`](testing-and-ci.md)), in two layers:

- **Per-file** — `eslint-plugin-i18n-json` (configured in [`eslint.config.js`](../eslint.config.js)) checks each file
  for JSON validity, **duplicate keys** (a plain `JSON.parse` silently keeps the last of a duplicated key, so a dup
  translation is otherwise invisible), and empty values. Run with `make eslint`.
- **Cross-locale key parity** — `tools/check-locale-parity.mjs` (`make lint-locales`) checks that every locale carries
  the same keys as the `en` reference. It's i18next-aware where the ESLint plugin isn't: it **normalizes plural
  suffixes** (`_one`/`_other`/… legitimately differ per language's CLDR plural rules) and treats the regional
  (`en-US`/`en-NZ`) and per-city (`*-zurich`/`*-india`) overlays as **override-only** — they may hold a subset of keys,
  so it flags only keys that are *absent from the reference* (typos / stale keys), never missing ones.

So when you add or remove a translation key, add or remove it across **all** full locales (the parity check enforces
this); the overlays need only the keys they actually change.

## See also

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the contribution workflow this fits into.
- [`CLAUDE.md`](../CLAUDE.md) — AI-assistant context (terse i18n summary).
