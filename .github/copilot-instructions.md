# Project Sidewalk — Copilot review guidance

Crowdsourced sidewalk-accessibility mapping. Backend: Scala 2.13 + Play 3.0,
Slick over Postgres/PostGIS. Frontend: vanilla JS (Grunt concat, no transpile),
Twirl views. Schema via Play evolutions. Two i18n systems.

## Don't duplicate the linters
Formatting and mechanical style are enforced by blocking CI gates: scalafmt,
ESLint, Stylelint, HTMLHint, locale key-parity. Do NOT spend review comments on
formatting, whitespace, quote style, semicolons, import order, or line length.
Focus on correctness, domain rules, and the conventions in the path-scoped files.

## Cross-cutting rules to flag
- **Backend is the source of truth.** Flag hardcoded frontend literals that mirror
  backend domain values: label colors/icons, enum members, value ranges (min/max),
  thresholds, and especially mappings between them. Colors must come from
  `util.misc.getLabelColors(labelType)`; other domain values from a `/v3/api/...` endpoint or
  a controller-injected view binding — never re-declared as a JS constant. Note:
  severity's good/ok/bad meaning is NOT fixed (positive vs negative features invert
  it), so flag any `{1:'good',2:'ok',3:'bad'}`-style literal.
- **Comments say WHY, not WHAT.** Flag comments that restate the code, and
  changelog/narration comments that only make sense against the diff. Tell-tale
  words: "used to", "previously", "formerly", "replaces the old", "renamed
  to/from", "no longer". Flag TODO/FIXME with no linked issue.
- **i18n:** user-facing text changes need translations in all supported languages
  (en, es, nl, zh-TW, de, pt-BR, en-US, en-NZ). See i18n instructions. EXCEPTION:
  admin-only pages/routes (`app/views/admin/**`, `/admin/*`) ship English-only —
  do not flag missing translations there.
- **Accessibility:** new/changed UI must meet WCAG 2.1/2.2 AA — flag missing alt
  text, unlabeled controls, non-token colors with poor contrast, keyboard traps.
