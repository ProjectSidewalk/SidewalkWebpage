# Plan: replace mobile Validate with responsive immersive Validate ([#5580](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5580))

> **Temporary — delete before merging.** This plan is committed only so it can be worked on remotely. It is not part
> of the codebase: remove `docs/planning/` from the branch before any #5664 / #5580 PR merges into `develop`.

Written 2026-10-06 against `origin/develop` at `5c68a3270`. Every line number below was read on that commit; treat
them as anchors to re-find, not gospel. Read with
[#4875](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4875)'s
[design doc (Decisions 1–7)](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4875#issuecomment-5303658125),
[#5560](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5560) /
[PR #5583](https://github.com/ProjectSidewalk/SidewalkWebpage/pull/5583) (immersive crowd Validate),
[#4891](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4891) (responsive `/mobile`),
[#5561](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5561) /
[#5562](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5562) (iOS memory kill, prefetch),
[#5587](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5587) (immersive Expert Validate) and
[#5665](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5665) (stop redirecting phones).

## Decisions resolved (Jon, 2026-10-06) — read before the slices

1. Mission screens: **(a)** — #4886 mission-complete card everywhere, desktop table deleted; briefing by width.
2. One-tap Agree: **(a)** — `quickAgree` for `pointer: coarse` only.
3. `label_validation.source`: **(a)** — `ValidateMobile` = touch-primary control variant. Document the changed meaning
   in the API docs and the release notes (a touch laptop now counts).
4. Rollout: **no A/B, no rollout flag — "just ship it."** Consequences for §4 and §5:
   - **S0 (gate query) is optional**, informational only; it no longer decides anything.
   - **S3 shrinks to a QA-only `?layout=immersive` override** (lets a phone reach the unified page while `/mobile` still
     serves phones by default, so S4a–c can be QA'd on real devices). No `validate.phone-layout` config, no `split`
     bucketing, no `Visit_Validate_PhoneArm` / `Validate_Layout` arm logging, no comparison SQL. If S4a–c land in
     quick succession, S3 can be folded into S4a.
   - **S5 becomes "ship":** delete the phone redirect so `/validate` serves everyone; `/mobile` stays reachable only
     via the override for one release as an escape hatch. S6 (delete the fork, 301 `/mobile` → `/validate` preserving the
     query string, override removed) follows in the next release.
   - Ignore §4's flag/arm/comparison material and §7's `split` risks; keep §4's three predicates.
5. Tablets: **accept** the 600 px narrow breakpoint — iPads get wide immersive with 44 px touch controls.

Shared helper: `util.isTouchPrimary()` = `util.inputProfile().coarse`; `inputProfile()` is specified in the #5664 plan
(`5664-ipad-touch-explore-plan.md` §5.2). Whichever plan lands first adds both.

## 0. Where the code is today (the facts the plan rests on)

- Two pages, one bundle. `/validate` renders `app/views/apps/validate.scala.html` (entry
  `frontend/js/pages/validate.js` → `validate/start.js`); `/mobile` renders `app/views/apps/mobileValidate.scala.html`
  (entry `frontend/js/pages/mobileValidate.js` → `validate/start.js` + `frontend/js/mobileValidate.js`). Both run
  `frontend/js/validate/Main.js`. Rolldown builds one bundle per `frontend/js/pages/*` entry (`rolldown.config.mjs`).
- Selection is UA on the server (`ControllerUtils.isMobile`, `app/controllers/helper/ControllerUtils.scala:33-56`),
  stamped on `<html data-mobile-device>` (`app/views/common/main.scala.html:31`) and read back by `util.isMobile()`
  (`frontend/js/common/utilities.js:360`). `ValidateController.validate` (`:68-103`) 302s a mobile UA to `/mobile`
  with the query string; `mobileValidate` (`:164-198`) 302s a desktop UA to `/`; `expertValidate` (`:115-157`) 302s a
  mobile UA to `/mobile` and drops the query string.
- Immersive mode ([#5560](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5560)) is CSS over the boxed
  DOM: `public/css/pages/validate/svv-immersive.css` keyed on `body.svv-immersive`, toggled by the shared
  `frontend/js/common/ImmersiveMode.js`. The dock is `#validation-menu-holder` floated bottom-centre (`:106-121`), the
  pill is `#mission-status` (`:49-64`). It is built only when `!util.isMobile()` (`Main.js:245-257`).
- The phone is **not** reachable by immersive today, and immersive is **not** usable at phone width:
  `Main.applyValidateScale` (`Main.js:467-479`) fits a 720×560 reference into the window with
  `util.applyToolScale`'s `MIN_SCALE = 0.65` (`utilities.js:274`), so a 390×844 window gets `--ui-scale: 0.65`:
  verdict buttons 56×21 px (base 86×32, `svv-validation-menu.css:53-62`), reason buttons 23 px, 10 px body text.
- The two menus differ in **behaviour**, not only layout. `MobileValidationMenu.js:30-41` submits on the Agree tap;
  `DesktopValidationMenu.js:37-44` records Agree and waits for Submit (`:192-195`, key `S`/Enter). Mobile's No and
  Unsure panels carry their own Skip/Submit (`MobileValidationMenu.js:110-134`); desktop has one Submit, and a Submit
  with no reason chosen is exactly mobile's Skip. Mobile floats the thumb off the tapped button
  (`MobileValidationMenu.js:406-425`); desktop does not.
- `validation_task_interaction` has no user column; rows tie to a validator through `mission_id`. Tracker notes are
  serialised `key:value,key:value` (`frontend/js/validate/Tracker.js:98-110`).

## 1. Size the stakes: the gate query

Read-only, against the prod database that holds the per-city schemas (one `sidewalk_<city>` schema each; ids are
per-schema, so every row carries its schema name and nothing is joined across schemas). Column facts: evolution
`202.sql` replaced `label_validation.is_mobile` with `source` (`ValidateMobile` for the phone page), `279.sql` renamed
the desktop values to `Validate` / `ExpertValidate`, `298.sql` + `332.sql` made it the `ui_source` enum; the Slick
table (`app/models/validation/LabelValidationTable.scala:92-108`) has `user_id`, `mission_id`, `end_timestamp`
(timestamptz), `source`. Run in `psql`; `\gexec` executes the generated statement.

```sql
-- Phone share of crowd validations per city, last 12 months, plus a total row.
-- Denominator is crowd Validate only (Validate + ValidateMobile); ExpertValidate, LabelMap, Gallery, SidewalkAI and
-- the rest are reported in `other`, never in the share.
SELECT 'WITH v AS (' || string_agg(format(
  $q$SELECT %1$L AS city, source::text AS source, count(*) AS n, count(DISTINCT user_id) AS users
     FROM %1$I.label_validation
     WHERE end_timestamp >= now() - interval '12 months'
     GROUP BY source$q$, nspname), ' UNION ALL ' ORDER BY nspname) || $q$)
SELECT coalesce(city, 'ALL CITIES') AS city,
       sum(n) FILTER (WHERE source = 'ValidateMobile')                                   AS phone,
       sum(n) FILTER (WHERE source = 'Validate')                                         AS desktop,
       sum(n) FILTER (WHERE source = 'ExpertValidate')                                   AS expert,
       sum(n) FILTER (WHERE source NOT IN ('Validate', 'ValidateMobile', 'ExpertValidate')) AS other,
       round(100.0 * sum(n) FILTER (WHERE source = 'ValidateMobile')
             / nullif(sum(n) FILTER (WHERE source IN ('Validate', 'ValidateMobile')), 0), 1) AS phone_pct_of_crowd,
       sum(users) FILTER (WHERE source = 'ValidateMobile')                               AS phone_validators,
       sum(users) FILTER (WHERE source = 'Validate')                                     AS desktop_validators
FROM v
GROUP BY ROLLUP (city)
ORDER BY (city IS NULL), phone DESC NULLS LAST$q$
FROM pg_namespace
WHERE nspname LIKE 'sidewalk\_%' AND nspname <> 'sidewalk_login'
\gexec
```

Two corroborating reads, same `\gexec` shape (swap the inner template):

```sql
-- (a) Page loads: the design doc's own gate. webpage_activity(activity, timestamp) per schema.
SELECT %1$L AS city, activity, count(*) AS visits
FROM %1$I.webpage_activity
WHERE "timestamp" >= now() - interval '12 months'
  AND activity IN ('Visit_Validate', 'Visit_MobileValidate', 'Visit_Validate_RedirectMobile',
                   'Visit_ExpertValidate_RedirectMobile', 'Visit_MobileValidate_RedirectHome')
GROUP BY activity
-- (b) Monthly trend, to see campaign spikes rather than a flat average.
SELECT %1$L AS city, date_trunc('month', end_timestamp) AS month, source::text AS source, count(*) AS n
FROM %1$I.label_validation
WHERE end_timestamp >= now() - interval '12 months' AND source IN ('Validate', 'ValidateMobile')
GROUP BY 2, 3
```

Reading the result: `phone_pct_of_crowd` on the `ALL CITIES` row is the headline; the per-city rows pick the rollout
cities (§4). [#5561](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5561)'s 90-day read (302 phone POSTs,
46 users, three quarters iOS WebKit) suggests low single digits, in which case the fold is a maintenance decision
and the A/B in §4 can be shortened to a parity check (Decision 4).

## 2. Inventory: what each UI has that the other lacks

Every `util.isMobile()` in the validate bundle, plus the mobile-only page pieces. "Replacement" is the predicate or
mechanism the plan maps it to; the three predicates are defined in §4.

| Site | Mobile today | Desktop / immersive today | Replacement |
|---|---|---|---|
| `Main.js:96`, `:281` KeyboardManager | none (no keyboard) | built | Always built once the DOM is one (`optionalCommentTextBox` exists); legacy page keeps the skip until deleted |
| `Main.js:126` `VALIDATE_BUSY_SELECTORS` (`:51-55`) | six named elements (no app holder) | `#svv-application-holder`, `#validation-menu-holder` | One list (desktop's); delete `.mobile` with the view |
| `Main.js:226` `svv.labelRadius` | 15 (32 px mark; 44 px target via CSS) | 10 (22 px × scale; 24 px target floor) | `util.isTouchPrimary() ? 15 : 10` (control variant) |
| `Main.js:230` menu class | `MobileValidationMenu` | `DesktopValidationMenu` | One `ValidationMenu` with `quickAgree` (Decision 2) |
| `Main.js:245` `ImmersiveMode` | not built (page is full-bleed) | built, opt-in | Always built; **forced** on narrow (`isNarrowLayout()`), toggle hidden |
| `Main.js:277-318` `PinchZoomDetector` vs PanoOverlay / Keyboard / SpeedLimit / ZoomControl / ImageAdjustments / `MissionStartTutorial` | pinch logger only | all desktop features | All built always (touch listeners are inert with a mouse; mouse ones inert under a click-through layer). `MissionStartTutorial` only when `!isNarrowLayout()`; narrow uses the carousel briefing (Decision 1) |
| `Main.js:330-360` resize | throttle 150 ms, pinch guard, `sizePano()` + viewer resize, `Window_Resized{width,height,orientation,rotated}` | `applyValidateScale()` per event, debounced `Window_Resized{width,height}` | One handler: rescale per event, pinch guard (skip when `clientWidth/Height` unchanged), debounced log with mobile's richer notes on every layout |
| `Main.js:387` `PanoInfoPopover` | none | date pill + popover | Always built; narrow keeps the date pill in the 30 px strip the dock leaves clear (§3) |
| `Main.js:532` pano-interactive hint | none | 6 s toast naming mouse gestures | `if (util.isTouchPrimary()) return;` (copy names mouse gestures) |
| `Form.js:130-138` `getSource()` | `ValidateMobile` | `Validate` / `ExpertValidate` | `ValidateMobile` ⇔ touch-primary control variant (Decision 3) |
| `Label.js:38,67,136,298` `isMobile` properties | set, never submitted (`ValidateFormats.scala` has no field) | same | Delete (dead since evolution 202) |
| `ModalMission.js:208-209` briefing | swipe carousel of `MissionStartTutorial.slidesFor`, logs `MSTSlide_Swipe` | `MissionStartTutorial` overlay (1095 px reference, `mission-start-tutorial.css:21`) | By **width**: carousel on narrow, overlay otherwise |
| `ModalMission.js:242` title fit (`#fitTitleWhenReady`, `:139-172`) | shrinks the briefing h1 to one line, re-fits when the face loads | n/a (modal is display:none on desktop) | Narrow only (the element is visible only there) |
| `ModalMissionComplete.js:33,156` "Start an exploration mission" every 3rd mission | never (Explore bounces phones) | offered | Keep `!util.isMobile()` here, allow-listed, until [#5665](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5665) stops the bounce; it is the one honest device-class gate (offer Explore iff the server would serve it) |
| `ModalMissionComplete.js:39` next-mission briefing | none (carousel is `ModalMission`'s) | `MissionStartTutorial` | `!isNarrowLayout()` |
| `ModalMissionComplete.js:79` standing line | "N all-time validations", badge, progress to next badge | bare number in a table | Mobile's markup everywhere (Decision 1) |
| `ModalMissionComplete.js:104-112` celebration | fireworks class, `navigator.vibrate([40,60,40])`, `Confetti.burst()` | none (`#mission-complete-celebration` absent) | Mobile's markup everywhere; the method already no-ops without the element |
| Mission-complete type icon (`mobileValidate.scala.html:175-178`) | label type's marker beside the sentence | none | Carried with the markup |
| `ModalNoNewMission.js:21,43,90,98` dead end | "validate in another city" copy, button → sidewalk-sea `/validate`, full-width button | "Start Exploring" → `/explore` | Narrow layout → mobile copy and link (Explore bounces phones); wide → desktop |
| `PanoManager.js:99` `scrollwheel: util.isMobile()` | true (never reaches GSV: `GsvViewer.js:103` hardcodes false) | false | Delete the option (dead) |
| `PanoManager.js:136-139` + `sizePano()` (`:766-789`) | JS sizes pano to viewport below the 40 px header | CSS sizes pano (`--pano-width/height`, 100vw×100dvh in immersive) | Delete; immersive CSS already sizes the pano |
| `PanoManager.js:141-145` GSV attribution moved into `#view-control-layer` | skipped | moved, scaled by `--ui-scale` | Always; under a click-through layer the links don't take taps, as on mobile today (note in docs; Google's own links stay inside `#svv-panorama` for touch) |
| `PanoManager.js:209-215` capture date | none | bottom-left date | Always |
| `PanoManager.js:267-275` POV at render | centre the label (`setPov(labelPov)`) | labeler's heading/pitch/zoom | `isNarrowLayout()` → centre (a portrait frame can put the labeler's view off the label) |
| `PanoMarker.js:176-234` marker activation | tap-slop touch handlers + click + Enter/Space | hover/focus (`:234+`), keys via KeyboardManager | `util.isTouchPrimary()` (control variant, fixed per load, Decision 3 of #4875) |
| `PannellumViewer.js:64-74` 8192 width cap ([#5561](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5561)) | capped | uncapped | **Keep `util.isMobile()`**: a memory cap is about the device, not the pointer; lives in `common/`, out of the validate bundle |
| `LabelDetail.js:921`, `PopupPanoManager.js:518` | hide Explore links | show | Untouched (other pages; retire with #5665) |
| `mobile-validate.css:611-627` click-through `#view-control-layer`, marker `pointer-events: auto`, 44 px target | yes | layer takes the mouse (`PanoOverlay.js`), 24 px target | `@media (pointer: coarse)` block in `svv-panorama.css` |
| `mobile-validate.css:637-667` label card ×1.2 type bump | yes | no | `@media (pointer: coarse) and (width <= 600px)` |
| `mobile-validate.css:671-692` 44 px overlay pills | yes | 22 px × scale | `@media (pointer: coarse)`: `max(44px, calc(<base> * var(--ui-scale)))` |
| `mobile-validate.css:695-713`, `frontend/js/mobileValidate.js:3-13` `.animate-button` press animation | class added by JS to 8 buttons | none | CSS-only `@media (pointer: coarse) .validate-page-button:active, …` ; delete the JS |
| `frontend/js/mobileValidate.js:15-38` double-tap-zoom suppressor over the two canvases | yes (tested by `test/js/mobileValidatePage.test.js`) | none | Move into the bundle as `frontend/js/validate/panorama/DoubleTapSuppressor.js`, imported by `start.js`; it is touch-event-only so needs no gate |
| `mobile-validate.css:720-795` verdict row | full-bleed, 44–48 px, thumbs, pale chosen fills, ≤360 px type drop | dock buttons 86×32×scale with thumbs (`svv-immersive.css:138-155`) | §3 narrow rules |
| `mobile-validate.css:843-860` notch (`#mobile-popup-notch`, `mobile-popup-notch.svg`) | points panel at verdict | dock grows upward, no notch | Delete with the view |
| `mobile-validate.css:863-934` reason panels | bottom sheet, `width: min(60vw, 400px)`, max-height to the header, 44 px buttons, 16 px input | sections inside the dock, 36 px buttons/input | §3: dock sections, `pointer: coarse` bumps, `font-size: 16px` on inputs |
| `mobile-validate.css:937-961` Skip / Submit per panel | two buttons per panel | one Submit (+ Back) | Submit with no reason = skip; `Click=DisagreeReason_Skip` / `UnsureReason_Skip` retire (logged-events note) |
| `mobile-validate.css:86-103, 321-568` mission screens (`mv-*`) | full-screen scrolling cards, sticky actions, sign-in pill (`.sign-in-up-button-mobile`) | boxed modals; immersive centres a compact card (`svv-immersive.css:266-323`) | Decision 1 |
| `mobileValidate.scala.html:15` `@common.main(..., "/mobile")`, no navbar | no chrome at all | navbar; hidden by `html.chromeless` in immersive | Forced immersive on narrow = no navbar (#4875 Decision 6b); sign-in pill and a logo-link-home live on the briefing |
| `mobile-validate.css:966-973` test-server banner under the header | banner visible | `html.chromeless` hides it | Accept: immersive already hides the banner on desktop |
| Mobile-only logged events | `Visit_MobileValidate`, `Visit_MobileValidate_RedirectHome`, `Visit_Validate_RedirectMobile`, `Visit_ExpertValidate_RedirectMobile`, `MSTSlide_Swipe`, `Pinch_ZoomIn/Out_Start/End`, `Click=DisagreeReason_Skip`, `Click=UnsureReason_Skip`, `Click_NoMoreMissionModal_ValidateSeattle`, `Window_Resized` with `orientation`/`rotated` | `Click_ZoomIn/Out`, `KeyboardShortcut_*`, `*_ImmersiveMode_*`, `Click_ClearVerdict`, `Click_ImageAdjustments_*`, `PanoInfo*_Click`, `NextSlideButton_Click`, `Click=AgreeCommentTextbox` | Visits and Skips retire at the fold (§5 S6); `MSTSlide_Swipe`, `Pinch_*`, `Window_Resized` notes continue on every layout; new `Validate_Layout` (§4) |

Shared already, nothing to port: Tracker per-verdict flush, `PageHidden`/`Unload`, `Validate_UnexpectedUnload`,
`MissionLiveMarker`, `PanoImageCache` prefetch, the expired-pano shortcut, `ValidateInputDropped_*`, the loading status,
the label card, `LabelVisibilityControl.toggleLabelCard`.

## 3. Narrow-portrait layout for immersive

Three queries, nothing else, mirrored once in JS (`Main.NARROW_LAYOUT_QUERY`, `Main.SHORT_LAYOUT_QUERY`) with a comment
naming the CSS block they mirror, the way `--label-min-target` mirrors `util.LABEL_MIN_SCREEN_TARGET`:

| Name | Query | What it decides |
|---|---|---|
| narrow | `(width <= 600px)` | Phone portrait. Forced immersive, scale pinned to 1, edge-to-edge dock, pill below the corner row, zoom stack hidden, briefing carousel, label centred. Same number `main.css:1593` already uses for the banner. |
| short | `(height <= 500px)` | Phone landscape (844×390). Dock height cap, reason options in two columns. |
| touch | `(pointer: coarse)` | 44 px targets, click-through control layer, no hover rules, press animation, 16 px inputs. Precedent: the `(hover: hover)` gates at `svv-validation-menu.css:86,309` and `Main.js:189`. |

A 1024×768 iPad matches none of the first two, so it gets the wide immersive (or boxed) layout with touch controls:
#4875 Decision 2's own example. (Decision 5 below.)

**Scale.** `util.applyToolScale` gains `opts.scale`: when given, the fit is skipped and exactly that scale is written
(`--ui-scale` on `.tool-ui` and `:root`, MST overlay scale derived as now). `Main.applyValidateScale` passes
`{ scale: 1 }` when `isNarrowLayout()`. Everything authored as `calc(N px * var(--ui-scale))` then reads at its base
size and the `--text-*` tokens at native size, which is `mobile-validate.css`'s philosophy (its header comment) and
#4875 Decision 7. Tablets keep the fit (768×1024 → 1.07; 1024×768 → 1.37), so touch bumps are written as
`max(44px, calc(<base>px * var(--ui-scale)))` and only lift at small scales.

**Narrow rules** (new block at the end of `svv-immersive.css`, all under `body.svv-immersive` + the narrow query;
reference device 390×844, floors checked at 360 and 320):

- `.tool-ui`: `--svv-bottom-clear: calc(30px + env(safe-area-inset-bottom))`. The 30 px strip along the bottom edge
  stays uncovered: Google's Street View logo sits there (`svv-panorama.css:303-308`) and Maps Platform terms require
  it visible; the date pill (`#svv-panorama-date-holder`, `bottom: 0`, 28 px) and the Mapillary pill share the strip.
- Corner row, top 8 px: `#label-visibility-control-holder { top: 8px; left: 8px }`; `.pano-overlay-button` 44 px
  (touch block); `#speed-limit-sign { top: 8px; right: 8px }`; `#zoom-buttons-holder { display: none }` (pinch zooms;
  mobile has no zoom buttons); `#immersive-toggle-holder` is `hidden` by JS when forced.
- Pill `#mission-status`: `top: 60px; left: 8px; right: 8px; transform: none; max-width: none; justify-content:
  center`. Icon 22 px, title `--text-small-bold` with ellipsis, bar 60 px, count. At `(width <= 360px)`:
  `#mission-title { display: none }` (the icon and the dock's question still name the type; "a pill that drops the
  title" from the issue).
- Dock `#validation-menu-holder`: `left: 8px; right: 8px; bottom: var(--svv-bottom-clear); transform: none; width:
  auto; max-height: calc(100dvh - 60px - 44px - 16px - var(--svv-bottom-clear)); padding: 10px 12px 12px; gap: 10px;
  border-radius: 12px`. `overflow-y: auto` already (`:113`).
- Verdict row `#validation-button-holder { gap: 8px }`; `.validate-page-button { flex: 1 1 0; width: auto;
  min-height: 48px; font: var(--text-small-bold) }`, thumb 18 px; at `(width <= 360px)` `font:
  var(--text-caption-semibold)` (pt-BR "Não tenho certeza" is the sizing case, `mobile-validate.css:729-744`). Chosen
  fills stay the dock's (`svv-validation-menu.css:72-83`); the hover rules are already under `(hover: hover)`.
- `#main-validate-header { font: var(--text-body-bold); padding-right: 40px }` (clears the X).
- `#validate-verdict-clear { width: 44px; height: 44px; top: 0; right: 0 }`, icon stays 14 px.
- Reason sections: `.validation-reason-button { min-height: 44px; height: auto; padding: 8px 12px; font:
  var(--text-small-medium); white-space: normal }`; `.validate-text-input input { height: 44px; font-size: 16px }`
  (exactly 16: iOS zooms on focus below it, `mobile-validate.css:931-934`); `#no-reason-options,
  #unsure-reason-options { gap: 8px }`.
- `#validate-submit-section { gap: 12px }`; `#validate-undo-button { min-height: 44px; padding: 0 8px }`;
  `#validate-submit-button { flex: 1; max-width: 220px; min-height: 44px }`.
- `#label-card { --ui-scale: 1.2; max-width: min(288px, calc(100vw - 24px)) }` plus the four token step-ups from
  `mobile-validate.css:643-667`, under narrow+touch.
- `#pano-image-adjustments`, `#pano-info-popover`: `max-width: calc(100vw - 16px)` (both are desktop panels reaching
  a phone for the first time; QA item).
- Mission screens (Decision 1): the `svv-mc-*` card (`mv-*` renamed to the validate family's `svv-` prefix,
  `tools/lint/check-css-layout.mjs:52`) is `position: fixed; inset: 0; width/height: 100%; border-radius: 0` on
  narrow with sticky full-width actions (`mobile-validate.css:513-552`); on wide it stays the centred card
  `svv-immersive.css:287-296` already draws.

**Short rules** (`(height <= 500px)`): `#mission-status { top: 8px; left: 50%; right: auto; transform:
translateX(-50%); max-width: calc(100vw - 2 * 120px) }` (the corner controls are short, so the pill goes back
between them); dock `max-height: calc(100dvh - 60px - var(--svv-bottom-clear))`; `#no-reason-options,
#unsure-reason-options { display: grid; grid-template-columns: 1fr 1fr }` with the text input spanning both
columns.

**Touch rules** (`(pointer: coarse)`), split by file: `svv-panorama.css` gets `#view-control-layer { pointer-events:
none }`, `#validate-pano-marker { pointer-events: auto }`, `#validate-pano-marker::after { --label-min-target: 44px
}`, `.pano-overlay-button { height: max(44px, calc(22px * var(--ui-scale))) }`; `svv-validation-menu.css` gets the
`max(44px, …)` floors on `.validate-page-button`, `.validation-reason-button`, `.validate-text-input input`, the
`.validate-page-button:active` press animation (`confirm-press`, `mobile-validate.css:695-713`), and
`prefers-reduced-motion` turning it off; `svv-immersive.css` gets `#validate-verdict-clear:hover` and
`#validate-undo-button:hover` moved under `(hover: hover)` (sticky `:hover` after a tap otherwise).

**WCAG 2.2 AA checks this satisfies**: 2.5.8 target size (every control ≥ 44 px under touch; 24 px floor elsewhere
unchanged), 1.4.10 reflow (390 px with no horizontal scroll; `phone-viewport.spec.js` measures it), 1.3.4
orientation (both orientations supported, no lock), 1.4.4 (viewport meta keeps pinch zoom; `SeoSpec:212-222`
pins it), 1.4.11 / 2.4.7 (the white `:focus-visible` rings from
[PR #5583](https://github.com/ProjectSidewalk/SidewalkWebpage/pull/5583) cover the dock), 2.3.3 (float and
fireworks already gated on `prefers-reduced-motion`), 1.4.3 (white on the 88 % asphalt scrim stays past 9:1).

## 4. Selection, flag, and how the two arms get compared

**Three predicates replace `util.isMobile()` in the validate bundle** (and a jest test greps
`frontend/js/validate/**` to keep it out, allow-listing only `ModalMissionComplete`'s Explore offer):

- `util.isTouchPrimary()` → `util.inputProfile().coarse` (`inputProfile()` is specified in the #5664 plan §5.2: coarse,
  hover, shortSide, maxTouchPoints; one capability helper for both bundles, whichever plan lands first adds both),
  equivalent to `window.matchMedia('(pointer: coarse)').matches`, added to `utilities.js` beside
  `isMobile` (`:356-360`, whose comment already says "prefer a capability query"). Read once per construction where
  it picks a control variant (menu, marker), live elsewhere. #4875 Decision 3(a): control fixed per load.
- `Main.isNarrowLayout()` / `isShortLayout()` → the two width/height queries. Live: `matchMedia('change')` listeners
  in `Main` call `svv.immersiveMode.refreshForced()` and `Main.relayout()`.
- `svv.legacyMobile` → `param.layout === 'mobile'` from a new `"layout": "mobile"` key in
  `mobileValidate.scala.html`'s `#page-data` (`:233-249`). Only the old page sets it; every branch keyed on it is
  deleted in S6. During the rollout a phone on `/validate` has `util.isMobile()` true but must get the unified UI,
  which is why the stamp cannot stay the key.

**No UA on the server for Validate** after S6. `ValidateController.validate` serves `validate.scala.html` to
everyone; `mobileValidate` becomes a 301. `data-mobile-device` and `ControllerUtils.isMobile` stay for the pages
#5665 covers.

**`ImmersiveMode` gains `forced`** (`frontend/js/common/ImmersiveMode.js`): option `forced?: () => boolean`
(default `() => false`) and method `refreshForced()`. When forced: `#active = true`, classes applied, `#holder.hidden
= true`, `toggle()` returns early (so `F` and the button do nothing, no exit hint), nothing written to
`sessionStorage` (a forced sitting must not become a stored choice). When `refreshForced()` flips it off (window
grown past 600 px), the stored preference is restored and the button shown. Explore passes nothing and is unaffected.

**The rollout flag** (S3):

- `conf/application.conf`: `validate.phone-layout = "mobile"` with `${?VALIDATE_PHONE_LAYOUT}` (dummy in
  `docker-compose.yml`; do not read the override file). Values `mobile` (today), `immersive`, `split`.
- `ValidateController.validate`: `if (isMobile && phoneArm(request) == "mobile") redirect /mobile else serve`.
  `phoneArm` = query `layout=immersive|mobile` if present (QA override, honoured on every stage), else the config
  value, with `split` bucketing on `Math.floorMod(request.identity.userId.hashCode, 2)` (anonymous users have a
  stable `userId` from `/anonSignUp`, so an arm sticks to a person across missions). Log
  `Visit_Validate_PhoneArm=immersive` beside the existing `Visit_Validate`, keep `Visit_Validate_RedirectMobile`
  for the other arm.
- Client: `Validate_Layout` pushed once per page load right after `createAMission` (`Main.js:379`, beside
  `ImmersiveMode_Restored`), notes `layout:<mobile|immersive|boxed>,pointer:<coarse|fine>,hover:<bool>,width,height,
  orientation`. `Main` is shared, so the `/mobile` arm logs it too, which is what makes the join below possible.

**Comparison SQL** (per schema, same `\gexec` wrapper as §1; `source` says phone, `Validate_Layout` says arm;
`validation_result` is the `validation_option` enum since `322.sql`, so the literal compare is right; replace the
`rollout_start` date):

```sql
WITH arm AS (
  SELECT mission_id, substring(note FROM 'layout:([a-z]+)') AS layout
  FROM validation_task_interaction
  WHERE action = 'Validate_Layout' AND "timestamp" >= '2026-MM-DD'::timestamptz  -- rollout_start
), v AS (
  SELECT lv.*, a.layout
  FROM label_validation lv JOIN arm a USING (mission_id)
  WHERE lv.source = 'ValidateMobile' AND lv.end_timestamp >= '2026-MM-DD'::timestamptz  -- rollout_start
)
SELECT layout,
       count(*)                                                     AS validations,
       count(DISTINCT user_id)                                      AS validators,
       -- agreement with the label's settled verdict; only labels with another vote besides this one
       round(100.0 * avg(CASE WHEN (v.validation_result = 'Agree') = l.correct THEN 1 ELSE 0 END)
             FILTER (WHERE l.correct IS NOT NULL AND l.agree_count + l.disagree_count >= 2), 1) AS agreement_pct,
       -- validations per minute, per mission, median across missions
       percentile_cont(0.5) WITHIN GROUP (ORDER BY m.per_min)       AS median_validations_per_min,
       -- missions finished over missions this arm started
       round(100.0 * count(DISTINCT mission_id) FILTER (WHERE mi.completed)
             / nullif(count(DISTINCT mission_id), 0), 1)            AS mission_completion_pct
FROM v
JOIN label l   ON l.label_id = v.label_id
JOIN mission mi ON mi.mission_id = v.mission_id
JOIN (SELECT mission_id, count(*) / nullif(extract(epoch FROM max(end_timestamp) - min(start_timestamp)) / 60, 0)
             AS per_min FROM label_validation GROUP BY mission_id) m ON m.mission_id = v.mission_id
GROUP BY layout;
```

Add the same `GROUP BY layout` over `validation_task_interaction` for `Validate_UnexpectedUnload`,
`ValidateInputDropped_Loading`, `ValidateInputDropped_Debounce`, `ModalUndo_Click` and `MissionComplete` counts.
`l.correct` is a majority over votes including this one, so `agreement_pct` is a proxy; the `>= 2` filter keeps a
lone vote from grading itself. Decide on the three headline numbers plus the unload rate; report per city and
pooled.

## 5. Slices, in dependency order

Each is one PR off `origin/develop`; branch names start with `5580-`. "Checks" means the gates in `CLAUDE.md`
(`make scalafmt-fix`, `make compile`, `make lint`, `make test-js`, `make test-scala only=…`, `make test-e2e`) plus
what is listed. Nothing here touches the pano by browser automation; §7 has the device checklist.

### S0. Gate (no code)

Jon runs §1 on prod. Output feeds Decision 4 (rollout scope) and nothing else blocks on it.

### S1. Foundations, behaviour-preserving (`5580-touch-predicates`)

- `utilities.js`: add `util.isTouchPrimary()`.
- `ImmersiveMode.js`: `forced` option + `refreshForced()`; JSDoc.
- `Main.js`: `NARROW_LAYOUT_QUERY`, `SHORT_LAYOUT_QUERY`, `isNarrowLayout()`, `isShortLayout()`; read
  `param.layout` into `svv.legacyMobile`; push `Validate_Layout` after `createAMission` (`:379-385`).
- `mobileValidate.scala.html:233-249`: `"layout": "mobile"` in `#page-data`.
- `Label.js`: delete the four `isMobile` lines; `PanoManager.js:99`: delete `scrollwheel`.
- `docs/logged-events.md`: `Validate_Layout` row (next to `ImmersiveMode_Restored`, `:263`).
- Tests: `test/js/immersiveMode.test.js` adds "forced at construction hides the button, sets both classes, stores
  nothing, ignores toggle", "refreshForced() off restores the stored choice and shows the button";
  `test/js/validateTrackerKeyNotes.test.js`-style case that `Validate_Layout` carries the six notes.
- Acceptance: `/validate` and `/mobile` look and behave exactly as before; a `Validate_Layout` row per page load with
  `layout:mobile` on `/mobile` and `layout:boxed`/`immersive` on `/validate`.

### S2. One menu, three predicates (`5580-one-validation-menu`)

- Rename `menu/DesktopValidationMenu.js` → `menu/ValidationMenu.js` (class `ValidationMenu`), constructor option
  `{ quickAgree }`. With `quickAgree`: the Agree handler (`:37-44`) records the verdict and calls `#validateLabel`
  at once, as `MobileValidationMenu.js:30-41` does, so no comment section opens; `#floatVerdict`
  (`MobileValidationMenu.js:406-425`) moves in and runs from `#validateLabel` when `quickAgree`. Submit with no
  reason chosen stays what it is (mobile's Skip).
- `Main.js:230-232`: `svv.legacyMobile ? new MobileValidationMenu(...) : new ValidationMenu(svv.ui.validationMenu,
  { quickAgree: util.isTouchPrimary() })`. `MobileValidationMenu` survives only for the legacy page.
- Replace every other `util.isMobile()` in `frontend/js/validate/**` per the §2 table (legacy-page branches on
  `svv.legacyMobile`, control branches on `util.isTouchPrimary()`, layout branches on `Main.isNarrowLayout()`).
  `PanoMarker.js:176` → `util.isTouchPrimary()`. `Form.getSource()` → `svv.legacyMobile || util.isTouchPrimary()
  ? 'ValidateMobile' : …` (Decision 3). `ModalMissionComplete.js:33,156` keep `util.isMobile()` with a comment
  pointing at #5665.
- Tests: `validateLoadingGuard.test.js:291-360` (menu-path scan) points at `ValidationMenu.js`;
  `validateMissionScreens.test.js` swaps its `isMobile` fake for `legacyMobile`/`isNarrowLayout`; new
  `test/js/validateMenuQuickAgree.test.js` (Agree submits once with `quickAgree`, waits for Submit without; the
  float appears under `quickAgree` and never under reduced motion); new `test/js/validateNoIsMobile.test.js` that
  reads `frontend/js/validate/**` and fails on `util.isMobile(` outside the allow-list.
- Acceptance: desktop (`pointer: fine`) unchanged; `/mobile` unchanged; a touch-emulated desktop `/validate` boxed
  page submits on Agree and shows the float.

### S3. Rollout flag and arm logging (`5580-phone-layout-flag`)

Lands before the layout slices so their phone-UA e2e can reach the unified page through `?layout=immersive`.

- `application.conf` key, `docker-compose.yml` dummy env, `ValidateController.validate` arm logic and the
  `?layout=` override, `Visit_Validate_PhoneArm=…` logging; `docs/logged-events.md` rows; `docs/deployment-and-stages.md`
  note on the env var; the §4 comparison SQL saved as `scripts/sql/5580_phone_arms.sql` (or kept in this doc if
  `scripts/README.md` says `scripts/` is the wrong home).
- Scala: `test/controllers/ValidatePhoneLayoutSpec.scala` (GuiceOneAppPerSuite, `UserAgents.mobile`, anon session as
  in `ValidateTriageParamsSpec:81-92`): `mobile` → 302 `/mobile` with the query string; `immersive` → 200 with
  `build/js/validate.js` in the body; `split` → the same user always gets the same answer; `?layout=` overrides all
  three; a desktop UA is never redirected.
- Acceptance: test stage set to `split`; both arms reachable by `?layout=`. Until S4a lands, the `immersive` arm
  on a phone is the unusable 0.65-scale page, so `split` stays off prod until S4a–c are in.

### S4a. Narrow immersive layout (`5580-immersive-narrow`)

- `utilities.js:263-305`: `opts.scale`. `Main.applyValidateScale` (`:467-479`) pins 1 on narrow; `Main.relayout`
  unchanged. One resize handler replaces `:330-360` and `:502-514`: rescale per event, pinch guard, debounced
  `Window_Resized{width,height,orientation,rotated}`; the `svv.legacyMobile` page keeps `sizePano()` until S6.
- `Main.js:245-257`: build `ImmersiveMode` always with `forced: () => Main.isNarrowLayout()`; `isDisabled` stays
  `adminVersion`; narrow listeners call `refreshForced()` + `relayout()`.
- `Main.js:277-318`: build everything always; `MissionStartTutorial` only when `!isNarrowLayout()`;
  `PanoManager.js:267-275` centre on narrow.
- CSS: the §3 narrow, short and touch blocks across `svv-immersive.css`, `svv-panorama.css`,
  `svv-validation-menu.css`; `#immersive-toggle-holder` hidden by JS when forced.
- `validate.scala.html:168-174`: keep the toggle markup (hidden when forced).
- Tests: `test/js/validateWindowResized.test.js` gains the pinch-guard and notes cases; `immersiveMode.test.js`
  forced-by-media case; e2e in `test/e2e/explore-validate.spec.js` next to the `/mobile` block (`:172-205`):
  `/validate?layout=immersive` under `PHONE_DEVICE` (portrait 390×844 and landscape 844×390): terminal state,
  `body` has `svv-immersive`, `#immersive-toggle-holder` hidden, every `#validation-button-holder .validate-page-button`
  bounding box ≥ 44 px tall, `horizontalOverflowReport` has no offenders, Pannellum rendered (reaches the page
  through S3's `?layout=` override).
- Acceptance: DevTools iPhone 13 emulation of `/validate?layout=immersive`: forced immersive, dock edge-to-edge,
  44 px targets, pill readable, no horizontal scroll, label centred, rotation reflows without reload, the Google
  logo strip clear. Desktop immersive and boxed pixel-identical to before (compare screenshots at 1440×900).

### S4b. Mission screens (`5580-mission-screens`, Decision 1)

- Move the `mv-*` mission-complete markup (`mobileValidate.scala.html:159-222`: celebration, type icon, three stat
  tiles, standing/badge/progress, stacked actions) into `validate.scala.html:184-215`, renamed `svv-mc-*`; delete the
  desktop table (`:189-208`) and its two `conf/messages/*` keys (`validate.mission.complete.category`,
  `validate.mission.complete.your.overall.total`; all locales, `make lint` checks parity). Styles from
  `mobile-validate.css:321-552` move to `svv-modal.css` under the new prefix, with the narrow full-screen variant and
  the wide centred card.
- Briefing: `#modal-mission-holder` in `validate.scala.html:176-183` takes mobile's structure
  (`mobileValidate.scala.html:132-157`: header with city logo as a link to `/` + sign-in pill via `data-au-open`,
  eyebrow, h1, instruction, sticky actions). `ModalMission.setMissionMessage` builds the carousel when
  `isNarrowLayout()`; `#fitTitleWhenReady` runs only then. `ModalNoNewMission` picks copy by `isNarrowLayout()`.
- `ModalMissionComplete`: `#showStanding` always writes the "all-time" sentence (the table is gone); `#celebrate`
  unchanged (element now always present; `navigator.vibrate` is a no-op without haptics).
- Tests: `validateMissionScreens.test.js` re-keyed on layout; a case that the wide layout builds no carousel
  (`:213-222` already) and that the celebration class is applied on both layouts.
- Acceptance: mission start and mission complete on 390×844 match today's `/mobile` screens; on desktop immersive
  the compact card shows fireworks, type icon, tiles and standing; boxed desktop shows the same card over the pano.

### S4c. Touch details (`5580-touch-details`)

- Move `frontend/js/mobileValidate.js:15-38` to `frontend/js/validate/panorama/DoubleTapSuppressor.js`, import from
  `start.js`; delete the `.animate-button` loop (`:3-13`) in favour of the CSS `:active` rule; `pages/mobileValidate.js`
  shrinks to `import '../validate/start.js'` (the legacy page still needs the suppressor, which now ships in the
  bundle).
- On-screen keyboard: Android shrinks the layout viewport, which the S4a resize handler already answers (dock and
  pano follow `100dvh`). iOS only moves the visual viewport; add in `Main` a `window.visualViewport` `resize`
  listener that sets `--svv-keyboard-inset: calc(innerHeight - visualViewport.height - visualViewport.offsetTop)` on
  `.tool-ui` while a dock input has focus, and the narrow dock uses `bottom: calc(var(--svv-bottom-clear) +
  var(--svv-keyboard-inset, 0px))`. Measure on device first (§7); if iOS already scrolls the fixed dock into view,
  drop the listener.
- `test/js/mobileValidatePage.test.js` → `test/js/validateDoubleTap.test.js` (same cases, new module path).
- Acceptance: unit suite green; device check of the keyboard behaviour in both OSes.

### S5. Flip the default (`5580-immersive-default`)

After the comparison (Decision 4): `validate.phone-layout = "immersive"` default; `/mobile` still served for
`?layout=mobile` for one release as the escape hatch; release notes name the date (Decision 5 of #4875: the date
bounds the analytics eras).

### S6. Delete the fork (`5580-delete-mobile-validate`)

- Delete: `app/views/apps/mobileValidate.scala.html`, `public/css/pages/mobile-validate.css`,
  `frontend/js/validate/menu/MobileValidationMenu.js`, `frontend/js/pages/mobileValidate.js`,
  `frontend/js/mobileValidate.js`, `public/images/icons/mobile-popup-notch.svg`, `VALIDATE_BUSY_SELECTORS.mobile`
  and every `svv.legacyMobile` branch, `PanoManager.sizePano`, `svv.ui.validationMenu.mobilePopupNotch`, the
  `tools/lint/check-css-layout.mjs:48` entry, `conf/messages/*` `validate.skip.reason`, `main.scala.html:15`'s
  `"/mobile"`.
- Routes/controller: `GET /mobile` → `ValidateController.mobileValidate` becomes
  `Redirect(routes.ValidateController.validate(None, None, None).url, request.queryString, MOVED_PERMANENTLY)`
  (the `UserController.signInMobile` pattern, `:128-130`); `validate` loses `isMobile` and the flag; `expertValidate`'s
  phone branch (`:124-127`) redirects to `/validate` **with** `request.queryString` until #5665 lands its in-page
  notice; `validate.phone-layout` config and `?layout=` go.
- `app/views/mobileLanding.scala.html:24,83`: `href="/mobile"` → `/validate`. `navbar.scala.html:16-20` comment.
- Specs: `SeoSpec:212-222` → "`/mobile` is a 301 to `/validate`"; `ValidateTriageParamsSpec:81-92` → 301 with
  `?regions=` preserved in `Location`; delete `ValidatePhoneLayoutSpec`; `MobileDetectionSpec` unchanged
  (the stamp stays).
- e2e: the `/mobile` block (`explore-validate.spec.js:172-205`) becomes the `/validate` phone block from S4a without
  the override; `phone-viewport.spec.js` header comment; `test/e2e/README.md:206-213`.
- Docs: `docs/architecture.md:188,384` (mobile Validate mentions) and the Validate paragraph; `docs/logged-events.md`
  retires `Visit_MobileValidate`, `Visit_MobileValidate_RedirectHome`, `Visit_Validate_RedirectMobile` and
  `Click=DisagreeReason_Skip`/`UnsureReason_Skip` the way `:274-276` retire the sign-in visits
  (`Click_NoMoreMissionModal_ValidateSeattle` continues: the narrow dead end keeps its link), and rewrites the
  `Window_Resized` row (`:259`); `docs/accessibility.md` Tool UIs paragraph (immersive is the phone layout);
  `app/views/apiDocs/validations.scala.html:100,196` and `labelEdits.scala.html:169` describe `ValidateMobile` as the
  touch variant (Decision 3).
- Acceptance: `git grep -n 'mobileValidate\|mobile-validate\|MobileValidationMenu\|/mobile"'` returns only the
  301 route, history in docs, and `mobileLanding`; `curl -I -A "iPhone" http://localhost:9000/mobile?regions=5` →
  301 `Location: /validate?regions=5`; full gate battery green.

Follow-ups filed, not done here: relocating the date pill / attribution under the narrow dock
([#5177](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5177) is the attribution half), a touch wording
for the pano-interactive hint, Expert Validate on phones ([#5587](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5587)
+ [#5665](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5665)), the minimap corner from #5560.

## 6. Decisions that need Jon (ALL RESOLVED — see "Decisions resolved" at the top; text below kept for the reasoning)

1. **Which mission screens survive.** (a) Mobile's #4886 mission-complete card (fireworks, type icon, tiles,
   badge standing) at every width, desktop table deleted; briefing by width (carousel narrow, `MissionStartTutorial`
   wide). (b) Both markups kept behind width queries. (c) Desktop's table everywhere. **Recommend (a)**: it is the
   design-system restyle, it already has everything the issue lists to carry over, and (b) keeps the double
   maintenance the fold exists to end. Cost: desktop immersive and boxed get a new mission-complete look.
2. **One-tap Agree on touch.** (a) `quickAgree` for `pointer: coarse` (Agree submits at once, as `/mobile` today;
   hover devices keep Submit and the optional comment). (b) Everyone waits for Submit. (c) Everyone one-tap.
   **Recommend (a)**: it is the only behavioural branch left between pointer classes, it keeps mobile's
   validations-per-minute, and Back covers a slip. (b) would make the A/B measure a deliberate slowdown.
3. **`label_validation.source` after the fold.** (a) `ValidateMobile` means the touch-primary control variant
   (`isTouchPrimary()`), so the series and the `/v3/api/validations?source=` filter continue; a touch laptop joins it.
   (b) Retire it: everything is `Validate`, device class from `validation_task_environment`. **Recommend (a)**;
   document the new meaning in the API docs. Either way the release date bounds the eras.
4. **Rollout scope.** Where `split` runs and for how long: **recommend** the test stage first, then the three
   cities with the highest `phone` count from §1, until each arm has ≥ 500 phone validations or four weeks, whichever
   is later; if `ALL CITIES` `phone_pct_of_crowd` is under ~3 %, skip `split` and go straight to `immersive` on the
   test stage plus one city, treating the comparison as a parity check rather than an experiment.
5. **Tablets at fold time.** #4875 Decision 1 recommended "(a) phone UI for all touch devices at fold time". With
   immersive as the base there is no separate phone UI left to give an iPad: the only knob is the 600 px width
   query, which puts every iPad on the wide immersive (or boxed) layout with 44 px touch controls, i.e. Decision 1's
   (b) by construction. **Recommend accepting that**; the alternative is raising the narrow breakpoint above 768 px,
   which would also force immersive and the carousel on tablets.

## 7. Risks, and the real-device QA checklist

Risks:

- **Google logo and terms links.** Maps Platform terms require the Street View logo visible; the narrow dock reserves
  a 30 px strip (§3). Verify on device in both orientations; if the dock's content pushes it over the strip, the dock
  scrolls, never grows.
- **iOS keyboard** moves the visual viewport only; the dock input may hide under the keyboard. S4c has the
  `visualViewport` contingency; measure before building it.
- **Memory on phones** is unchanged: the 8192 cap keys on `util.isMobile()` in `common/` and the per-verdict flush is
  shared. The unified page loads more JS (Tom Select, turf, image adjustments) than `/mobile`; check
  `Validate_UnexpectedUnload` per arm in §4.
- **No navbar on phones** (forced immersive hides it, #4875 Decision 6b). The briefing's logo links home and the
  sign-in pill opens the shared dialog; without them a phone has only browser-back, which is `/mobile` today.
- **Mapillary / Panoramax touch**: the click-through layer is proven on GSV and Pannellum (`/mobile` today); the
  Mapillary SDK handles its own touch, Panoramax's PSV too, but neither has been driven under this layout.
  `richmond-va` (Mapillary) locally, `bayonne-fr` (Panoramax) on the test stage.
- **Analytics discontinuity**: `canvas_width/height` on phones switch from the 390×~800 mobile frame to the same
  numbers under immersive (both measure `#view-control-layer`), so projection is unaffected (the
  [frame contract](../label-latlng-estimation.md)); `Visit_*` and Skip events retire at S6; `Window_Resized` on
  desktop gains notes. All dated in the release notes.
- **Asset cache skew**: the fingerprinted bundle changes name, the view is new; the usual one-hour window for a
  returning phone, nothing special.
- **Expert Validate on a phone** redirects to `/validate` after S6 (query string kept); #5665's notice replaces that.
- **`split` on anonymous users**: `userId` is minted per anon session, so a person who clears cookies can change arm;
  acceptable noise.

Real-device checklist (every row on iPhone Safari, iPhone Chrome, Android Chrome; the tablet rows on iPad Safari;
pano interaction is never browser-automated per `CLAUDE.md`):

1. `/validate?layout=immersive` (S4) or `/validate` (S6) on a phone: forced immersive, no toggle, no navbar, no
   horizontal scroll, Google logo and date pill visible under the dock, pill readable, title drops at ≤360 px.
2. Pan with one finger, pinch to zoom the pano (not the page), double-tap on the pano does not zoom the page, a
   two-finger page pinch still works (WCAG 1.4.4).
3. Tap the marker: card opens anchored, Hide-label button ≥44 px, tap again closes; drag starting on the marker
   pans without opening the card.
4. Agree: one tap submits, thumb floats, next label within ~100 ms (prefetched), no `ValidateInputDropped_Debounce`
   storm from a second tap landing on the new label.
5. No: reasons appear, X clears, Submit with no reason submits; type a free-text reason: no iOS zoom on focus, the
   input stays above the keyboard, Enter submits, Escape (hardware keyboard on tablet) leaves the field.
6. Unsure: same as 5 on the unsure sheet.
7. Back after a verdict restores the verdict and reason; `ModalUndo_Click` flushes.
8. Rotate mid-mission both ways: no reload, pano re-sizes, marker re-centres, dock caps and scrolls in landscape,
   `Window_Resized` rows carry `rotated:true`.
9. Mission complete: fireworks, vibration (Android), tiles match the counts, badge standing, both buttons ≥44 px,
   next mission starts with the carousel briefing; swipe the carousel (`MSTSlide_Swipe`).
10. Dead ends: `?regions=<small region>` until no labels → narrow copy and link; `imageryUnavailable` retry path.
11. Lock the phone mid-mission, unlock: `PageHidden` row, no lost verdict; background the tab for five minutes on
    iOS: on return either the mission continues or `Validate_UnexpectedUnload` is logged and no verdict is lost.
12. Mapillary city: 2 and 3 again (the SDK's own touch); Panoramax on the test stage: 2 and 3.
13. Tablet portrait and landscape: wide immersive with the toggle, boxed reachable, 44 px targets, `MissionStartTutorial`
    legible, Image adjustments and pano info panels fit the width.
14. Sign in from the briefing pill; the dialog fits 390 px; shortcuts resume after it closes.
15. Test stage: `Visit_Validate_PhoneArm`, `Validate_Layout`, and one full §4 comparison query return rows.
