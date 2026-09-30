# Internationalization (i18n)

Project Sidewalk is translated into several languages, and **all user-facing text must be translatable** — never
hardcode display strings. This page is the single home for how i18n works, how to add or change translated text, and
how to add a whole new language.

## Supported languages

`en` (default), `es`, `nl`, `de`, `pt-BR`, `zh-TW`, `fr`, plus the regional English variants `en-US` and `en-NZ`. The
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

> **Place names (`city.name.*`, `state.name.*`, `country.name.*`) get a line in every `messages.<lang>` file, even
> where the name reads as it does in English.** The English proper noun lives in the base `messages`; `zh-TW` carries
> a transliteration and the Latin-script files the exonym where one exists (`Nueva York`, `États-Unis`). Where a
> language spells the name as English does, the line still goes in with that spelling: nothing else records that
> someone looked, so a missing line would be indistinguishable from "same as English" and `make onboard-city` could
> never say what is still owed. Cities onboarded before this rule are not backfilled; a name added from here on
> follows it.

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

### Interpolated values and HTML

`AppManager._setupI18next` sets **`interpolation.escapeValue: false`**, so `i18next.t('key', { name })` interpolates
`name` exactly as given. In every sink that is not HTML — a text node, an `aria-label`, a `title`, a `confirm()`, a
share sheet, a `document.title` — escaping is something the reader sees: it is what turned a neighborhood called
*Al 'Ummah* into `Al &#39;Ummah` and a formatted date into `9&#x2F;16&#x2F;2026` (#5389).

The price is that a value bound for `innerHTML` is not escaped for free. **When a translated string with interpolated
values lands in markup, escape those values exactly once**, either way round:

```js
// The string builds markup, so i18next escapes what is put into it. The <a> in the translation still renders:
// escapeValue only ever touches values.
subtitle.innerHTML = i18next.t('common:subtitle', { href: DOCS_URL, interpolation: { escapeValue: true } });

// Or escape at the sink, when the same string also feeds a text sink (here an accessible name).
const label = i18next.t('accessscore:rank-row', { name: region.name });
row.button.setAttribute('aria-label', label);
row.button.setAttribute('data-ps-tooltip', util.escapeHTML(label)); // psTooltip renders this as HTML.
```

Markup sinks in this codebase are `innerHTML` / `outerHTML`, `insertAdjacentHTML`, a MapLibre popup's `setHTML`, and
the **`data-ps-tooltip` attribute**, which `psTooltip.js` writes into the tooltip card's `innerHTML`. Helpers count
too: `AlertController.showAlert`, `PopUpMessage.notify`, and the onboarding message boxes all render HTML. Text sinks
are everything else — a text node, `append()`, `alert` / `confirm`, a share sheet, and any other attribute, `title`
included.

The **`ps/i18n-escape-in-markup`** ESLint rule (`tools/lint/eslint-rules/i18n-escape-in-markup.js`) flags a `t()`
call that interpolates values and reaches one of those sinks without stating `interpolation.escapeValue`, whether
directly or through a template literal, a concatenation, a string method, a `map(…).join('')`, or a local variable.

**It is a tripwire, not a proof.** It follows syntax only: a value returned from a function, stored on an object
property, or handed to a helper that renders HTML is invisible to it, and so is a `t()` call behind an alias or a
wrapper (don't wrap `i18next.t`, and write `el.innerHTML`, never `el['innerHTML']`). Those flows are on the author
and the reviewer.

So when a string you build ends up as HTML somewhere the rule can't follow, escape it there or say
`escapeValue: true` here. Values we computed ourselves — a count, an id, an asset path — carry nothing to escape and
need neither. And if the rule fires on something that is really a text sink, the answer is `escapeValue: false` with
a comment, never `true`: turning escaping on at a text sink is the bug #5389 fixed.

Two things escaping never touches: the **translation string itself** (markup inside a locale value always renders),
and a variable written **`{{- labelType}}`**, which i18next interpolates raw whatever the setting is — the label-type
names use that, because the German ones carry a `&shy;`.

## Measurement units

Units are **not** a property of the language: readers choose metric or imperial on the Settings page (#4404), so every
language has to be able to render either.

**One verdict, server-side.** `ControllerUtils.measurementSystem` returns `MeasurementSystem.Metric` or `.Imperial` —
the units the reader saved on the Settings page (shared by every city, #3720) if any, else the language's default from
the `measurement.system` message. That message is a sentinel the code compares against, so it holds the literal string
`metric`, never a translation of the word. Never re-derive units from the language.

**The unit words live in `conf/messages` only**, as
`unit.distance.{abbr,abbr.small,name,name.singular}.{metric,imperial}`. `ControllerUtils.distanceUnitWords` resolves
the four for a request; Twirl reads them directly, and `main.scala.html` hands the same four to i18next as
[interpolation defaults](https://www.i18next.com/translation-function/interpolation#default-variables). Locale JSON
carries no unit words — a string just writes them, so a plain `i18next.t()` is always correct:

```json
"distance-left_one":   "Only {{count}} {{unitNameSingular}} left!",
"distance-left_other": "Only {{count}} {{unitName}} left!"
```

The defaults must be plain strings — a getter calling `i18next.t()` would recurse through interpolation. They reach
nested `$t(...)` references, and i18next's plural suffixes compose with them.

**Rendering a distance is the `distance` formatter's job** (`AppManager._addDistanceFormatter`):
`{{meters, distance(style: small)}}` converts, rounds, localizes the number, and appends the unit. Params are `style`
(`small` → m/ft to the nearest 25; `fine` → m/ft to the whole unit, for elevations; `large` → km/mi), `precision`, and `unit: false` for a bare number; separate several
with `;`. `util.distanceToString(meters)` and `util.longDistanceToString(km, precision)` call it from outside a string.

**Its input must be canonical** — meters for `small`, km for `large`. Values that arrive already converted
(`/userapi/basicStats` converts server-side; turf measurements are taken in `util.turfDistanceUnits()` so they can be
summed against those) would be converted twice, so those call sites name the unit with `{{unitAbbr}}` /
`util.unitWords()` and do no conversion.

Backend sentences take the unit noun as an argument rather than duplicating the sentence per system — see
`landing.stats.content.*`. Never put imperial wording in `messages.en-US` / `locales/en-US/`, which reach only readers
whose *language* is US English.

## Adding or changing user-facing text

1. **Add the key** to the appropriate backend message file or frontend namespace JSON, for the languages you can. For
   backend keys, the English goes in **`messages.en`** (never the base `messages` — see the callout above).
2. **Add temporary machine translations** for Spanish, Dutch, German, Portuguese, French, and Mandarin (`zh-TW`,
   traditional) — Google Translate is fine. A maintainer periodically sends the accumulated machine translations to our
   partners for proper ones, so don't block on official translations.
3. **Default to the generic `en`** files, and add **regional English overrides only where the wording actually
   differs**:
   - **`en-US`** — American spellings and phrasing. **Not** the place for imperial units: those are a measurement-system
     variant of the key, carried by every locale (see "Measurement units" above), not a regional overlay.
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
4. **Add the moment.js locale** (for localized dates). Skipping this fails silently — dates just render in English —
   which is how `de` and `pt-BR` went years without one. Download the [locale file](https://github.com/moment/moment/tree/develop/locale)
   matching our moment version into `public/vendor/moment/`, then add the lowercased language code to
   `momentLocaleFile` in [`app/views/common/main.scala.html`](../app/views/common/main.scala.html); the filename and
   the name the file registers with moment are both that same lowercased code. Only the active language's locale is
   sent to the browser, so adding one costs nobody but its own speakers. Only `en` and `en-US` need no file, because
   moment has US English built in — a new English variant still needs one, the way `en-NZ` does. (There's an open
   ticket, [#1258](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/1258), about moving off moment.js — don't
   take that on as part of adding a language.)
5. **Translate both measurement systems.** The unit words live in `conf/messages/messages.<lang>` as
   `unit.distance.*.{metric,imperial}` (see "Measurement units" above), so a new language needs both sets — even one
   whose speakers would never pick imperial, since the choice is the reader's. Nothing unit-related goes in the
   locale JSON.
6. **Test thoroughly.** Compare each main page against the English version (open them in adjacent tabs and flip
   between them) to catch layout breakage from differing text lengths. On Explore, place a label of each type and
   open the various sub-menus. Then open a PR and deploy to the test servers so the requesting partner can review the
   live result.

## Linting the translation files

The frontend i18next JSON under `public/locales/` is linted in CI (blocking steps in the `frontend` job — see
[`docs/testing-and-ci.md`](testing-and-ci.md)), in two layers:

- **Per-file** — `@eslint/json` (configured in [`eslint.config.js`](../eslint.config.js)) parses each file as JSON
  and checks it for **duplicate keys** (a plain `JSON.parse` silently keeps the last of a duplicated key, so a dup
  translation that overwrites a real one is otherwise invisible — nothing caught this before #5132), empty key names,
  and unsafe numbers. Run with `make eslint`.
- **Cross-locale key parity and empty values** — `tools/lint/check-locale-parity.mjs` (`make lint-locales`) checks that
  every locale carries the same keys as the `en` reference, and that no value is anything but a non-empty string
  (i18next only falls back on an *absent* key, so an empty string renders as blank rather than falling back to `en`).
  It's i18next-aware where a per-file JSON rule can't be: it **normalizes plural suffixes** (`_one`/`_other`/…
  legitimately differ per language's CLDR plural rules) and treats the regional (`en-US`/`en-NZ`) and per-city
  (`*-zurich`/`*-india`) overlays as **override-only** — they may hold a subset of keys, so it flags only keys that
  are *absent from the reference* (typos / stale keys), never missing ones.

So when you add or remove a translation key, add or remove it across **all** full locales (the parity check enforces
this); the overlays need only the keys they actually change.

## See also

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the contribution workflow this fits into.
- [`CLAUDE.md`](../CLAUDE.md) — AI-assistant context (terse i18n summary).
