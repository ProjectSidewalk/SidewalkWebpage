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

### Frontend — i18next (client-side JavaScript)

- Translations live in **`public/locales/<lang>/<namespace>.json`**, split into namespaces such as `common.json`,
  `audit.json`, `gallery.json`, `dashboard.json`, `routebuilder.json`, and `labelmap.json` (plus city-specific
  variants like `common-india.json`, `audit-zurich.json`).
- Reference a string with `i18next.t('namespace:your-key')`, **or prefer `data-i18n="namespace:key"` directly in the
  HTML** — that keeps the translation in i18next and avoids duplicating strings across JS and markup.

> Most user-facing text in the apps is in the **frontend** system. Reach for the backend message files only for
> server-rendered Twirl pages.

## Adding or changing user-facing text

1. **Add the key** to the appropriate backend message file or frontend namespace JSON, for the languages you can.
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

## See also

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the contribution workflow this fits into.
- [`CLAUDE.md`](../CLAUDE.md) — AI-assistant context (terse i18n summary).
