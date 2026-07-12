# WS0 design comps — sign-in / sign-up redesign (#4375)

**Throwaway review material — delete this directory before the final PR.**

`signup-comps.template.html` is the source for the Workstream-0 design comps: seven token-styled screens
(sign-in default/error, sign-up live-validation/server-error, /welcome, mobile parity, username-change status)
whose markup and CSS are written to transplant directly into `navbar.scala.html`, `welcome.scala.html`, and the
future `public/css/auth.css`. All colors/type are `main.css :root` tokens (values inlined at `--ui-scale: 1`,
scoped under `.ps-scope`).

The `__B64_*__` placeholders stand in for embedded assets (Mulish/Raleway fonts, wheelchair logo, badge art) so
the file stays diffable. To rebuild the self-contained review page, base64-encode
`public/fonts/Mulish/Mulish-latin.woff2`, `public/fonts/Raleway/Raleway-Bold.ttf`,
`public/images/logos/ProjectSidewalkLogo_NoText_WheelchairCircleCentered_100x100.png`, and
`public/images/badges/badge_missions_badge1.png`, and substitute.

Published review page (Claude artifact): https://claude.ai/code/artifact/35a8cf80-4925-45ac-aaf6-c73379679384
