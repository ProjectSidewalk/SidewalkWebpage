---
applyTo: "public/js/**/*.js"
---
# Frontend JS review (ES2022 target)

- Flag `var` (use const/let), string `+` concatenation for HTML (use template
  literals), and jQuery AJAX where native `fetch` + Promises fit. Prefer arrow
  functions in callbacks to keep `this` bound.
- The constructor-function pattern (`function Foo(){ const self=this; ...; return
  self }`) should be a `class` with `#private` fields. Flag new code using it.
- **No hardcoded domain values** (see repo-wide rule): use
  `util.misc.getLabelColors(labelType)` and `util.misc.getIconImagePaths(labelType)`; source enum
  members, ranges, and mappings from `/v3/api/...` or a view binding. Flag any
  `{1:'good',2:'ok',3:'bad'}`-style severity map.
- **Tool UI scaling:** in Explore, Validate, and overlays layered over them, every
  fixed px dimension set from JS must be `calc(<n>px * var(--ui-scale, 1))`. Flag
  bare px. (Fixed page chrome like the navbar is exempt.)
- **JSDoc** on every class and non-trivial method (including `#private`); use
  `@returns` (not `@return`) with a `{Type}`.
- Prefer `data-i18n="ns:key"` over hardcoded English strings in generated HTML.
