# Implementation plan: Explore on iPad — touch input for immersive Explore (tablets first)

> **Temporary — delete before merging.** This plan is committed only so it can be worked on remotely. It is not part
> of the codebase: remove `docs/planning/` from the branch before any #5664 / #5580 PR merges into `develop`.

Issue: [#5664](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5664). Phase 4 of
[#4875](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4875) ("split on interaction model, never on
device"). Builds on immersive Explore [#5085](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5085) (merged
as [PR #5477](https://github.com/ProjectSidewalk/SidewalkWebpage/pull/5477)). Companion:
[#5665](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5665) (phones get an in-page notice). Validate
counterpart: [#5580](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5580).

Written 2026-10-06 against `origin/develop` @ `5c68a3270` (frontend is ES modules under `frontend/js/`, bundled by
Rolldown; the issue body's `public/js/explore/src/…` paths are stale). All line numbers below are from that commit.
Nothing here was browser-tested; pano interaction can't be, and the plan says where that leaves gaps.

---

## Decisions resolved (Jon, 2026-10-06) — read before the slices

1. Sequencing with #5665: **(B)** — slice 3 builds #5665's Explore row (shared `util.inputProfile()` helper, notice,
   no redirect); #5665 does its other pages against the same helper.
2. Boundary: **no phone/tablet distinction**; gate on screen shape + size (§5.2 table): portrait small touch screen →
   rotate prompt; landscape small touch screen → soft notice until #5668; everything else → the tool.
3. Label-type strip: **(a) keep the top-centre strip** with narrow-width compaction. (Jon: on phones it may just be a
   two-handed interaction — relevant to #5668, not here.)
4. Immersive **on by default for `pointer: coarse`**, remembered per tab once exited.

## Status and open questions (2026-10-07) — after slice 5

All five slices are built and pushed, one branch each: `5664-touch-telemetry`, `5664-pointer-input`,
`5664-small-screen-notice`, `5664-touch-affordances`, `5664-touch-tutorial` (slice 5, `ca0cb73`). The QA branch
`5664-qa-combined` merges all five plus the whole #5580 stack. No PRs opened yet.

Open decisions for Jon:

1. **Tutorial steps that name an on-screen button still say "click" on touch.** About 9 steps read like "Click the Curb
   Ramp button", which looks odd on an iPad next to "Tap the curb ramp". Slice 5 left them alone. Making them
   touch-aware is ~25 more strings across 7 languages (plus the en-NZ overlay). Do it, or leave them?
2. **The severity examples card also shows on desktop.** Hovering the severity "i" now shows a wider card with three
   example images where it used to show one sentence. Keep it for everyone, or gate it to touch only?

Still to check:

- The new touch wording in all 7 languages has not been reviewed by native speakers.
- Manual QA for slice 5 that the automated tests don't cover: (a) tapping inside the open examples card does not close
  the label menu; (b) the three example images actually load into the card.

## 0. Three corrections to the issue's premises (read first)

1. **Explore is not mouse-only today.** `frontend/js/pages/explore.js` L34–51 `enableTouchSupport()` already replays
   `touchstart/touchmove/touchend` on `document` as synthetic `mousedown/mousemove/mouseup` on the touch's target, and
   cancels `touchmove` on `#interaction-area-holder` (`{passive: false}`) so a drag over the pano doesn't scroll. So on
   an iPad that reaches `/explore`, tap-to-place and drag-to-pan *mostly* work. What is actually wrong with the shim:
   - **Probable double-fire.** The shim never cancels `touchstart`/`touchend`, so after a tap the browser also fires its
     compatibility `mousedown/mouseup/click`. Canvas.js's `#handleDrawingLayerMouseUp` (L334–346) creates a label on
     *every* mouseup while a type is armed, and `#createLabel` only disarms via `setTimeout(backToWalk, 20)` (L150–152).
     Two mouseups inside 20 ms = two labels. Unverified (iOS only synthesizes mouse events on "clickable" targets, so it
     may not reproduce on Safari but will on Chrome/Android). Real-iPad QA item #1; the Pointer Events migration fixes it
     structurally (cancelling `pointerdown` suppresses compat mouse events).
   - Synthetic `MouseEvent`s are `isTrusted=false`, so `Tracker.trackWindowEvents()` (Tracker.js L39–42) logs their
     `cursorX/cursorY` as `null`, exactly like keyboard-scripted clicks. Touch sessions are invisible in the low-level log.
   - The holder-level `touchmove` cancel blocks **pinch** over the pano (no pinch-zoom of the pano exists) and blocks
     scrolling inside the context menu, which lives inside `#interaction-area-holder` (explore.scala.html L585).
   - Double-tap-to-zoom (iOS) is not suppressed anywhere (`touch-action` is set nowhere under `svl-*.css`).
2. **The pano viewers never receive input in Explore.** `#user-control-layer` (`#view-control-layer` + `#label-drawing-layer`)
   fully covers `#pano` (svl-canvas.css L10–31; `NavigationService.switchToLabelingMode/ExploreMode` L526–539 just swap
   which child is on top). GSV is built with `disableDefaultUI: true, clickToGo: false, scrollwheel: false`
   (GsvViewer.js L95–107, from PanoManager.js L210–212 `defaultNavigation: false`); Mapillary's `pointer: true`
   (MapillaryViewer.js L116), Panoramax's `mousewheel` and Infra3d's `setUserInteraction` are all under the overlay.
   Explore drives every POV change itself through `svl.panoManager.updatePov/setPov` (PanoManager.js L731–798). **So the
   design question "how do viewer-native gestures interact with the overlay" has a one-line answer: they don't, and
   must keep not doing so** — the overlay owns all input so that the frame contract (`docs/label-latlng-estimation.md`
   → "The frame contract") and `POV_Changed`-style logging stay in one path. Don't make the overlay click-through.
3. **iPads with the default (Macintosh) UA already get desktop Explore.** `ControllerUtils.isMobile` (ControllerUtils.scala
   L32–57) matches `(iPhone|webOS|iPod|Android|BlackBerry|mobile|SAMSUNG|IEMobile|OperaMobi|BB10|iPad|Tablet)`
   against the UA. iPadOS 13+ Safari (and Chrome on iPad) sends `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) …`,
   which matches none of those tokens → `isMobile = false` → `/explore` is served, `<html data-mobile-device="false">`,
   desktop navbar, the touch shim above. Bowser (`util.getOperatingSystem`, utilities.js L346–351) parses the same UA
   and records `operating_system = 'macOS'`, so **those sessions are indistinguishable from Macs in every table and in
   the funnel's device split** (FunnelStatTable.scala L238–241 regexes `operating_system`). Only iPads that send an
   `iPad` UA (Safari with "Request Mobile Website", Firefox iOS, pre-13 iPadOS) are bounced to `/mobileLanding` and
   logged `Visit_Audit_RedirectMobileLanding` (ExploreController.scala L56–62).

Consequence for sizing: the work is (a) make the existing touch path correct and gesture-complete, (b) make targets and
hover/keyboard-only affordances touch-honest, (c) let tablets in by capability, not UA — and (a)+(b) matter on day one
for the iPads already using the tool.

---

## 1. Measurement gate

### 1.1 What is captured today

`audit_task_environment` (AuditTaskEnvironmentTable.scala; one row **per submission** `POST /explore`, not per session,
so count `DISTINCT audit_task_id` / `mission_id`): `browser`, `browser_version`, `browser_width/height`
(`document.documentElement.clientWidth/Height`), `screen_width/height`, `avail_width/height`, `operating_system`,
`language`, `css_zoom`, `ip_address`, `timestamp` — written by Form.js L149–161 → `ExploreFormats.EnvironmentSubmission`
(L23–35) → ExploreController.scala L363–371. **Nothing records touch capability**: no `maxTouchPoints`, no
`pointer: coarse`, no `hover`. `validation_task_environment` has the identical column set (relevant to #5580).
`webpage_activity` has `Visit_Audit*` per visit (server-side, UA-free) and `Visit_Audit_RedirectMobileLanding` for the
bounced ones.

### 1.2 A lower-bound read from existing columns (no code change)

An iPad on a Mac UA still leaves two fingerprints a real Mac doesn't: (i) **its logical screen size** (iPads have a
short list of CSS-px screen sizes no Mac ships), and (ii) **`avail_height == screen_height`** — macOS always subtracts
the menu bar (≥25 px) from `screen.availHeight`; iPadOS doesn't. Both columns exist. Query A in Appendix A counts
`operating_system = 'macOS'` rows by those two signals over the last 180 days; Query B compares outcomes (labels per
task, task completion) for iPad-like rows vs the rest; Query C counts the bounced `iPad`-UA visits. Run per city
schema (ids are per-schema, never union ids across schemas; `(city, audit_task_id)` is the key if you concatenate).
Treat A as a floor: an iPad in Stage Manager/external display, or a Mac in true fullscreen, can cross either signal.

Cheapest first look that needs no DB: the GA4 toolkit (memory: `ga-analytics-toolkit`) with `deviceCategory=tablet`
on `/explore` pageviews — but GA4 classifies a desktop-UA iPad as desktop too, so it only sees the `iPad`-UA minority.

### 1.3 Slice 1 adds the real signal

Add two nullable columns to **both** environment tables (one evolution, same PR; next gapless number — 411 is HEAD on
develop as of this writing, so 412 unless an open PR has claimed it; `docs/evolutions.md` → "Numbering"):

```sql
# --- !Ups
ALTER TABLE audit_task_environment
  ADD COLUMN max_touch_points INT,
  ADD COLUMN primary_pointer TEXT CHECK (primary_pointer IN ('fine', 'coarse', 'none'));
ALTER TABLE validation_task_environment
  ADD COLUMN max_touch_points INT,
  ADD COLUMN primary_pointer TEXT CHECK (primary_pointer IN ('fine', 'coarse', 'none'));
# --- !Downs
ALTER TABLE validation_task_environment DROP COLUMN primary_pointer, DROP COLUMN max_touch_points;
ALTER TABLE audit_task_environment DROP COLUMN primary_pointer, DROP COLUMN max_touch_points;
```

Nullable, no default: pre-change clients and old rows read as "unknown", and no table rewrite at prod scale (the
tables are large; `ADD COLUMN` without a default is metadata-only). Client values: `navigator.maxTouchPoints` and
`matchMedia('(pointer: coarse)') ? 'coarse' : matchMedia('(pointer: fine)') ? 'fine' : 'none'`. An iPad on a Mac UA
reports `maxTouchPoints = 5` and `coarse`; an iPad with a Magic Keyboard trackpad reports `fine` + `hover` (and then
*should* get the mouse variant — that is the interaction-model principle working). After this lands, Query D in
Appendix A is the gate query and `touch-primary share of Explore tasks` is the number to watch.

Why columns rather than a one-off `InputCapabilities` interaction event: the gate question is per environment row,
the interaction tables are the heavyweight logs nobody wants to `LIKE` through, and Validate (#5580) needs the same
number from the same shape. Both `Form.js` files already build the environment object; it is a two-field addition.

**Gate (recommendation):** proceed with slices 2–5 regardless — iPads are already on the tool via the Mac UA and the
input layer has a probable double-placement bug — but let the numbers from 1.2/1.3 set *priority* and decide whether
the tablet layout work in slice 4 is worth doing before #5580's phone work. A touch-primary share of Explore tasks
under ~1% with no campaign spikes argues for slices 1–3 only (correctness + unblock) and deferring 4–6.

---

## 2. Interaction inventory (every mouse / hover / keyboard-only interaction, with the touch answer)

Legend for "today on touch": via the shim in `pages/explore.js` (S), native tap/click works (OK), broken/absent (✗).

| # | Interaction | Where (code) | Today on touch | Touch equivalent (proposed) |
|---|---|---|---|---|
| 1 | Place a label (armed type, click on pano) | Canvas.js L326–346 (`mousedown`/`mouseup` on `#label-drawing-layer`) | S, probable double-fire | **Tap** on the drawing layer: `pointerup` with ≤10 CSS px total movement. Mouse unchanged (any mouseup places). |
| 2 | Pan the pano (drag in Walk mode) | Canvas.js L195–279 (`#view-control-layer` down/move/up/leave) | S | **One-finger drag**, with pointer capture; `touch-action: none` on the layer. Same `updatePov(dx/2^zoom, dy/2^zoom)` math. |
| 3 | Pan while a label type is armed | — (drawing layer is on top; a mouse drag does nothing) | ✗ | **Touch/pen only:** a drag on the drawing layer pans (keeps the type armed); a tap places. Mouse behaviour unchanged. |
| 4 | Open a placed label's context menu | Canvas.js L206–234 (`mouseup` hit-test `onLabel` → `contextMenu.show`) | S | **Tap on the icon** opens the menu directly (no hover card step) — same as Validate's marker. Hit target floor 44 px (§4.2). |
| 5 | Hover card (type/severity/tags + Delete/Edit/Share) | Canvas.js L248–279, Label.js L378–403 | ✗ (no hover; a tap goes straight to #4) | **None needed**: the context menu (#4) carries Delete (`#context-menu-delete`, ContextMenu.js L148–158), Share (`#context-menu-share`) and every field the card shows. No info is hover-only. |
| 6 | Close context menu by clicking outside | ContextMenu.js L50–51, L99–109 (`document` `mousedown`) | S (compat mousedown) | Move to **`pointerdown`** on `document` (menu window stops propagation on `pointerdown`). Needed because slice 2 cancels `pointerdown` on the pano layers, which suppresses compat mouse events. |
| 7 | Severity 1–3 | radios in `#severity-radio-holder` (explore.scala.html L611–627); keys `Digit1–3` (KeyboardManager L52–56) | OK (tap = click) | Tap the segment; **44 px min-height** under `(pointer: coarse)`. |
| 8 | Tags | `.tag-pill--interactive` buttons built in ContextMenu.js L439–457; letter shortcuts (KeyboardManager L116–129) | OK | Tap; **44 px min-height**. |
| 9 | Description text box | `#context-menu-description-text-box` (L642); Enter closes (KeyboardManager L39–42) | OK, but iOS auto-zooms the page on focus (input font < 16 px) and the keyboard may cover the panel in immersive | `font-size: 16px` under coarse; `enterkeyhint="done"` (iOS Return → `key: 'Enter'`, which `KeyboardShortcuts.keyOf` matches by `e.key`, L37–38, so the existing close path works); re-anchor/ignore-resize rules in §4.4. |
| 10 | Done / Close / Delete buttons on the menu | ContextMenu.js L56–60 | OK | 44 px targets; close X gets a 44 px hit area via `::after`. |
| 11 | Severity example images, tag example images, "what is severity" info | `data-ps-tooltip` set in ContextMenu.js L503–506, L518–533; info icon L604 | ✗ (hover-only; on touch a tap *pins* a tooltip until the next pointerdown — psTooltip.js L385, L415) | psTooltip ignores `mouseover` under `(hover: none)` (focus/pin paths stay). Severity info icon becomes `data-ps-tooltip-pinnable` (`role="button" tabindex="0"`) and its pinned card shows the three example images for the type (slice 5, optional). Tag examples: deferred; names are self-describing. |
| 12 | Switch label type (ribbon circle) | RibbonMenu.js L81, L164–176 | OK | Tap. Circles are already 66–86 px. |
| 13 | "Other" subcategory popover (hover to open) | RibbonMenu.js L82–83, L180–213 (`mouseenter` shows `#ribbon-menu-other-subcategory-holder`) | ✗ (compat mouseenter opens it, then the click selects plain Other; it never closes — no mouseleave on touch) | Under `(hover: none)`: first tap on Other **opens** the popover without switching mode; tap a row to pick; tap Other again or anywhere else closes. Rows 44 px. Log `Click_SubcategoryMenu_Open`. |
| 14 | Back to Walk (`Esc`, or the Explore circle) | KeyboardManager L46; RibbonMenu | OK | Tap the Explore circle. Also automatic after each placement (Canvas L150–152). |
| 15 | Cancel armed type by leaving the pano (`mouseleave`) | Canvas.js L294–312 `watchPanoExit` | partial (compat events) | Leave as is. On touch the type is cancelled by tapping any control outside the pano, which is what happens anyway. Don't log `LabelingCanvas_MouseOut` for `pointerType !== 'mouse'`. |
| 16 | Zoom in/out buttons | ZoomControl.js L48–53; `#zoom-buttons-holder` | OK but 22 px (`ps-icon-button`, pano-overlay-buttons.css L19–26) | 44 px under coarse. |
| 17 | Wheel/trackpad continuous zoom | ZoomControl.js L55, L240–262 | ✗ | **Pinch** (two pointers) → continuous zoom through the same `#setZoom` clamp path (expose `setZoom(z, source)`), pan by centroid. Log `Pinch_ZoomIn_Start/End` / `Pinch_ZoomOut_*` (names already used by Validate's `PinchZoomDetector.js`). |
| 18 | `Z` / `Shift+Z` zoom keys; "press Z" tooltips; ZoomShortcutAlert nudge | KeyboardManager L48; explore.scala.html L517–520 tooltips; ZoomShortcutAlert.js | tooltips pin on tap; nudge is nonsense on touch | Tooltips suppressed by #11; nudge gated on `(hover: hover) and (pointer: fine)`. |
| 19 | Walk: click a nav arrow | SVG `<image>` in `#arrow-group` (PanoManager.js L598–627, 20/60 of a 220 px×scale box ≈ 73 px on screen) | OK | Tap. Already ≥44 px. Hover highlight (svl-canvas.css L123–152, PanoManager L307–316 `mouseover`) is cosmetic. |
| 20 | Walk: click the compass message | Compass.js L346–352 | OK | Tap. |
| 21 | Walk: `↑`/`↓` to linked pano, `←`/`→` rotate 2°, `Space` advance along route | KeyboardManager L29–36, L189–223 | ✗ (no keys) | Arrows (#19), drag (#2), compass message (#20), forward crumbs (#24), Stuck. No new gesture. |
| 22 | Double-click on pano (logged only) | Canvas.js L227–231 | S | Keep logging on a second tap within 300 ms. Browser double-tap zoom suppressed by `touch-action`. |
| 23 | Minimap drag/zoom (Google Maps), zoom/fit buttons | Minimap.js L66, L104–117; `#minimap-zoom-*` 22 px | OK (Google Maps handles touch) | Buttons 44 px. Map pinch is Google's. |
| 24 | Minimap crumbs / breadcrumbs / label markers (click); crumb hover lights the pano arrow | ForwardCrumbs.js L654–671 | OK (click); hover cosmetic | Tap. |
| 25 | Minimap legend toggle/card, coach "Got it", route overview inset | explore.scala.html L354–463 | OK | 44 px floors. |
| 26 | Stuck / chevron menu / Image / Sound / Feedback pills | PanoOverlayControls.js L34–46; `.pano-overlay-button` 30 px, toggle 28 px | OK | 44 px under coarse. |
| 27 | Image adjustments sliders | PanoImageAdjustmentsPopover.js | OK | — (range inputs; keep ≥44 px thumbs via the component's coarse rules). |
| 28 | Immersive toggle (`F` / button) | ImmersiveMode.js L98, KeyboardManager L47 | OK; exit hint says "Press F" | **Default on** for `(pointer: coarse)` (§4.3); touch copy for the hint; button 44 px. |
| 29 | Pano date pill / info popover | PanoInfoPopover.js (Popover API) | OK | — |
| 30 | Speed-limit sign `title`/tooltip, `#minimap-percent-observed` tooltip | tabindex=0 divs | focus shows | A tap focuses → tooltip shows via the focus path. Fine. |
| 31 | Alerts (`#alert-close`, `#alert-dont-show`) | svl-alert.css | OK | 44 px floors. |
| 32 | Mission-start overlay, mission-complete modal, survey | MissionStartTutorial.js, ModalMissionComplete.js | OK (buttons) | — (already real buttons; verify ≥44 px on device). |
| 33 | Share (hover card / menu header) | ShareWidget.js L186–189 uses `(pointer: coarse)` → native share sheet | OK | — |
| 34 | Tutorial: "grab and drag", "click", "Hover over the label and click the delete icon", "press Z" | OnboardingStates/audit.json L17–75; Onboarding.js L1121–1129 listens for `mousedown` on the drawing layer | S; `label-too-far-end` copy has no touch path | `pointerdown` in Onboarding; touch variants of the four copy strings that name a mouse/hover (all 7 locales + overlays); delete via the menu's Delete, which already honours the tutorial's last-label rule. |
| 35 | Low-level event log | Tracker.js L32–53 | synthetic = untrusted (`null` coords) | Log `LowLevelEvent_pointerdown/pointerup` for `pointerType !== 'mouse'` with `cursorX/Y` + `pointerType`; never log `pointermove`. |
| 36 | Keyboard-shortcut nudges (`KeyboardShortcutAlert`, "press C") | KeyboardShortcutAlert.js L19–37 | fires after N taps | Gate on `(hover: hover) and (pointer: fine)` like #18. |

Everything keyboard-only has an on-screen equivalent already; the real gaps are #3, #6, #11, #13, #17, the 44 px floors,
and the double-fire in #1.

---

## 3. Pointer Events migration design

### 3.1 Shape

New module **`frontend/js/explore/canvas/PointerInput.js`** (class `PointerInput`): a pure input normalizer attached to
`#view-control-layer` and `#label-drawing-layer`. It knows nothing about labels; it turns pointer events into a small
callback contract that Canvas.js consumes, and it is what the jsdom tests exercise:

```js
new PointerInput(layerEl, {
  onTap({x, y, pointerType, clientX, clientY}),        // pointerup with ≤ TAP_SLOP_PX movement (touch/pen);
                                                       // for mouse: every pointerup (today's semantics)
  onDragStart({pointerType}), onDrag({dx, dy}), onDragEnd({moved}),
  onPinchStart(), onPinch({zoomDelta, dx, dy}), onPinchEnd(),
  onHover({x, y}),                                     // pointermove with no button, mouse only
  onLeave(),
  toCanvas: (clientX, clientY) => {x, y},              // Canvas supplies util.mousePosition + exploreDisplayScale
});
```

Constants (documented, logged): `TAP_SLOP_PX = 10` (CSS px, Validate's PanoMarker uses ~10 real px), no tap time
limit (a slow, held tap is a deliberate precise placement; iOS long-press callouts are suppressed in CSS), pinch
starts when a second non-mouse pointer goes down on either layer.

### 3.2 Listener changes (what goes where)

| Today | Becomes |
|---|---|
| Canvas.js L67–69 `mousedown/mouseup/mousemove` on the drawing layer | `PointerInput` on the drawing layer: `onTap` → `#createLabel` (touch/pen) or, for mouse, keep "every pointerup places"; `onDrag` → pan only when `pointerType !== 'mouse'`; keep a `mousemove` listener solely for the custom cursor (L352–362; cursors don't exist on touch). |
| Canvas.js L80–83 `mousedown/mouseup/mousemove/mouseleave` on the view-control layer | `PointerInput`: `onDragStart/onDrag/onDragEnd` → `#mouseStatus.isLeftDown` + `updatePov`; `onTap` → `onLabel` hit-test → `contextMenu.show/hide` (mouse: on every pointerup as today); `onHover` → hover card (mouse only); `onLeave` → cursor + hover-card hide. `ViewControl_MouseDown/MouseUp` events keep their names (mouse) and gain a `pointerType` note. |
| Canvas.js L70 `watchPanoExit` (mouseenter/leave on the holder) | Unchanged. |
| ContextMenu.js L50–51 `mousedown` | `pointerdown` (document + menu window). Semantics identical for mouse (pointerdown precedes mousedown). |
| Onboarding.js L1129/L1223 `mousedown` on the drawing layer | `pointerdown`. |
| ZoomControl.js L55 `wheel` | Unchanged; add `onPinch` → `setZoom(startZoom + log2(d/d0))` through the existing clamp (`#setZoom` L302–320 → make a public `setZoom(zoom, source)`), plus `syncButtonsToZoom`. |
| RibbonMenu.js L82–83 `mouseenter/mouseleave` | Keep for hover-capable; under `(hover: none)` skip them and use the tap-to-open rule (§2 #13). |
| Tracker.js L35–43 | Add `pointerdown`, `pointerup` to the logged list, filtered to `pointerType !== 'mouse'`, note `{cursorX, cursorY, pointerType}`. |
| `pages/explore.js` L18, L34–51 `enableTouchSupport()` | **Delete.** The `touchmove` cancel is replaced by `touch-action`. |

### 3.3 Pointer mechanics

- `pointerdown`: record `{id, type, startX, startY, lastX, lastY, moved: false}`; `layer.setPointerCapture(e.pointerId)`
  (wrapped in try/catch — it throws for an inactive pointer, and jsdom lacks it); for `pointerType !== 'mouse'` call
  `e.preventDefault()` — per Pointer Events L2 §11 this suppresses the compatibility mouse events, which is the structural
  fix for the double-fire in §0.1. **Never** `preventDefault` a mouse `pointerdown` (it would block focus/selection
  semantics the page relies on; mouse behaviour must not change).
- `pointermove`: if the pointer is captured and movement exceeds slop → `moved = true`, emit `onDrag` with the delta since
  the last move (same `/ 2^zoom` scaling as Canvas L255–257, done in Canvas). Two active non-mouse pointers → pinch: emit
  `onPinch({zoomDelta: log2(dist/dist0), dx, dy})` from the centroid.
- `pointerup` / `pointercancel` / `lostpointercapture`: release; `onTap` only if `!moved` (touch/pen) — mouse always;
  `onDragEnd({moved})`. `pointercancel` (the browser took the gesture, e.g. a system edge swipe) ends the drag silently
  and resets `isLeftDown`, which today's code can't do (L238 only runs on `mouseleave`).
- `contextmenu` on the two layers: `preventDefault` only when the last pointerdown was touch/pen (Android long-press
  menu); right-click on the pano keeps today's browser menu.
- Keep `onselectstart = () => false` (Canvas L84).

### 3.4 CSS that makes the above possible (svl-canvas.css)

```css
/* Both interaction layers own every gesture over the imagery: the tool pans, pinches and places; the browser must not
   scroll, zoom or pan on their behalf, or Pointer Events would be cancelled mid-drag. */
#user-control-layer { touch-action: none; }
.window-streetview { -webkit-touch-callout: none; user-select: none; }
/* Everywhere else in the tool a double tap must not zoom the page (it fires between two quick label placements);
   pinch-zooming the page chrome stays available (WCAG 1.4.4; main.scala.html deliberately sets no maximum-scale). */
.tool-ui { touch-action: manipulation; }
```

`touch-action: none` on the layer is what stops the browser from converting a second finger into a page pinch, so
pinch reaches our handler. The viewport meta (`width=device-width, initial-scale=1`, main.scala.html L45–46) stays.

### 3.5 Mode-dependent tap vs drag (summary)

| Layer on top | Pointer type | tap | drag | 2-finger |
|---|---|---|---|---|
| view-control (Walk) | mouse | up over icon → menu; else nothing (today) | pan (today) | — |
| view-control (Walk) | touch/pen | ≤10 px → icon? menu : nothing | pan | pinch zoom (+ centroid pan) |
| drawing (type armed) | mouse | every up places (today) | nothing (today) | — |
| drawing (type armed) | touch/pen | ≤10 px → place | **pan, stay armed** | pinch zoom |

### 3.6 Immersive mode interplay

`ImmersiveMode.beforeToggle` already closes the menu/hover card and `svl.relayout()` re-rasters (Main.js L705–717).
`PointerInput` holds only the active pointer map; a relayout mid-drag is impossible to trigger from touch (the toggle is
a button). Pointer capture survives the `--ui-scale` change because coordinates are re-derived per move from
`getBoundingClientRect` via `util.mousePosition`.

---

## 4. Layout, touch targets, immersive default, orientation, keyboard

### 4.1 Where the base sizes are today (`--ui-scale` on an iPad)

`applyExploreScale` (Main.js L674–699) in immersive fits `--pano-base-width` 720 wide and 4+100+480 = 584 tall with
`maxScale: 3`, no margins: **iPad landscape 1024×768 → scale ≈ 1.31; portrait 768×1024 → ≈ 1.07** (boxed tutorial:
0.96 landscape, 0.70 portrait). At those scales the controls are: `.ps-icon-button` 22 px → 24–29 px; `.pano-overlay-button`
30 px → 32–39 px; chevron 28 px; context-menu close 18 px → 19–24 px; `.button--tiny` ≈ 20 px; tag pills ≈ 24 px;
severity segments ≈ 26 px; subcategory rows ≈ 30 px; label hit target floor `LABEL_MIN_SCREEN_TARGET = 24` CSS px
(utilities.js L72–77, L144–149). All below 44. The ribbon circles (66 px) and nav arrows (~73 px) are fine.

### 4.2 The touch-target floor

Add one token to `main.css` `:root`: `--target-min-touch: 44px;` (comment: WCAG 2.5.8 is 24 px; 44 is the floor mobile
Validate already uses, `mobile-validate.css` L7, L31, L625). Then, keyed on **`@media (pointer: coarse)`** (the codebase's
precedent: `filter-sidebar.css` L168, `gallery/cards.css` L98, `label-detail.css` L1327; not `any-pointer`, so a touch
laptop with a mouse keeps the mouse sizes):

- `css/components/pano-overlay-buttons.css`: `.ps-icon-button`, `.pano-overlay-button`, `.pano-overlay-toggle` →
  `min-width/min-height: max(<today>, var(--target-min-touch))`. Shared with Validate (same component), which is the
  point.
- `css/components/tag-pills.css`: `.tag-pill--interactive { min-height: var(--target-min-touch); }`.
- `css/pages/explore/svl-context-menu.css`: `.severity-segments .severity-button`, `.context-menu__action`,
  `.context-menu__close` (keep the 18 px glyph; a `::after { inset: -13px }` hit area), `#context-menu-description-text-box
  { font-size: 16px; min-height: 44px }` (the 16 px is what stops iOS Safari's focus auto-zoom of the whole fixed layout).
- `css/pages/explore/svl-ribbon.css`: `.ribbon-menu-other-subcategory { min-height: 44px }`.
- `css/components/label-hover-card.css` (`.label-hover-card__action-button`) — the card is mouse-only, so only the
  `.button--tiny` floor if the card ever shows on a pen; low priority.
- `css/pages/explore/svl-minimap.css`, `svl-alert.css`: the minimap buttons (`.ps-icon-button`, covered above),
  `#minimap-coach-dismiss`, `#minimap-legend-close`, `#alert-close`, `#alert-dont-show`.
- `utilities.js`: `util.LABEL_MIN_SCREEN_TARGET_TOUCH = 44`; `util.labelHitMargin(scale)` picks it when
  `matchMedia('(pointer: coarse)').matches` (keep in step with mobile Validate's `--label-min-target`, as the existing
  comment asks).

Not a redesign: nothing moves at `(pointer: fine)`, and `make lint` (Stylelint) is the only gate CSS gets.

### 4.3 Default immersive on touch-primary (capability-selected)

`ImmersiveMode` (ImmersiveMode.js L71–114): add `defaultActive?: () => boolean`; Explore passes
`() => window.matchMedia('(pointer: coarse)').matches`. Resolution order at construction: tutorial disabled → boxed;
`sessionStorage` says `'1'` or `'0'` → obey; URL `immersive=1` → on; else `defaultActive()`. **Storage becomes tri-state**:
today `toggle()` removes the key on exit (L146 `? '1' : null`), which would let the capability default re-enter the mode
on the next load after the user deliberately left it — write `'0'` on exit instead. `logRestored()` gains
`source: 'capability'`. The exit hint (L176–187) picks `common:immersive-exit-hint-touch` ("Immersive mode. Tap the ⤡
button to exit.") under `(hover: none)`; the `press.key` tooltips on the toggle/zoom buttons are moot once psTooltip
ignores hover there. The tutorial stays boxed (existing `isDisabled`, e2e asserts the toggle is hidden).

### 4.4 Tablet-width layout in immersive (iPad portrait is the hard case)

The centred strip is 9 slots × 76 px × scale ≈ 730 px at portrait's 1.07; the Stuck pill (left) and zoom stack (right)
sit on the same top line, so on a 768-wide window they collide (svl-immersive.css L96–100 assumes "any window wider
than the strip plus the controls"). The minimap card (`--sidebar-width` 250 × 1.07 ≈ 268 px, L138–146) also shares the
bottom-right with the compass message. Rule set, `body.svl-immersive` and `(max-width: 899px)` (named in a comment as
"tablet portrait"; `--breakpoint-*` can't be used in a media query):

- `.label-type-button-holder` slot 60 px, `.label-type-icon` 50 px (icon ring scales with it), `.label-type-name` pill
  at 7 px; strip width ≈ 580 px.
- `#minimap-holder` height/width `calc(160px * var(--ui-scale))`; `#compass-message-holder` moves above the minimap.
- The corner controls keep their corners; the strip stays top-centre (Decision 3 below for the alternative).

Landscape 1024 needs nothing. Everything stays at `(pointer: fine)` sizes on desktop windows of the same width because
the rules are additive floors, not re-flows — except the `max-width` block, which is width-keyed on purpose (a 800-px
desktop window in immersive has the same collision).

### 4.5 Orientation changes

Main.js L729–748 already rescales on `resize` and re-rasters after 150 ms. Add, in the settled handler: if the context
menu is open, re-anchor it (`ContextMenu.reanchor()` → `util.anchorPanelToLabel(this.#menuWindow,
label.getCanvasXY(), svl.LABEL_ICON_RADIUS)`, after `svl.canvas.resize()` has re-rendered `currCanvasXY`); hide the
hover card; and extend the `Window_Resized` note with `orientation` and `rotated` exactly as mobile Validate does
(validate/Main.js L339–358, `docs/logged-events.md` row). GSV's black-after-resize glitch is already handled by
`panoViewer.repaint()`. The frame contract is per-label (`originalCanvasFrame` captured at placement, Canvas L110), so a
rotation never corrupts a label; `svl.CANVAS_FRAME` for the *next* label follows the new aspect.

### 4.6 On-screen keyboard (description field)

iOS and Chrome Android (default `interactive-widget=resizes-visual`) do not resize the layout viewport for the keyboard,
so `100dvh` and `window.innerHeight` hold and no `resize` fires; the browser scrolls the *visual* viewport to reveal the
focused input, which shifts the `position: fixed` tool up and restores it on blur. Three guards:
1. `font-size: 16px` on the input under coarse (§4.2) — without it iOS zooms the page into the fixed layout.
2. In the resize handler, skip relayout when `document.activeElement === #context-menu-description-text-box` and only
   the height changed (a browser that does resize the layout for the keyboard would otherwise reshape the pano
   mid-edit and log a `Window_Resized`).
3. `enterkeyhint="done"`; Return already closes the menu via `KeyboardShortcuts.keyOf` (`e.key === 'Enter'`).
If QA shows the panel buried under the keyboard in landscape (likely: the menu anchors beside the label, which can be
in the bottom half), add `context-menu--keyboard` on `focusin` under coarse that pins the panel to `top: 8px` centred,
removed on blur. Deferred until seen.

### 4.7 Hover-only information and tooltips

`psTooltip.js` L385 `document.addEventListener('mouseover', …)` → return early when `!matchMedia('(hover: hover)').matches`
(keep `focusin`, pinned and keyboard paths). This replaces Validate's per-page strip (validate/Main.js L189–191) and is
the one shared change outside Explore in this plan. Severity info icon → pinnable card with the three example images
(slice 5). `KeyboardShortcutAlert`/`ZoomShortcutAlert` → `if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;`.

### 4.8 Design-system / a11y checklist for the new bits

Tokens only (`--target-min-touch`, existing spacing/scrim); no hex; sizes `calc(<n>px * var(--ui-scale, 1))` except the
44 px floor, which is deliberately unscaled (a target floor is a physical size). Real `<button>`s everywhere already.
WCAG 2.2: 2.5.8 (targets) by §4.2; 2.5.7 (dragging movements) — every drag has a non-drag alternative (arrows, compass,
crumbs, zoom buttons); 2.5.1 (pointer gestures) — pinch has the zoom buttons; 1.4.13 (hover content) — nothing is
hover-only on touch after §4.7; 2.4.11 — the context menu is anchored inside the pano, never under fixed chrome.

---

## 5. Server side and the phone/tablet boundary (coordinate with #5665)

### 5.1 Why not just drop `iPad|Tablet` from the regex

`ControllerUtils.isMobile` is the single mobile definition and gates **Validate** too (`ValidateController.scala` L69,
L124, L181 → `/mobile`), the navbar (`navbar.scala.html` L20, L54–58, L94–110, L209), `/`, `/routeBuilder`,
`/accessScore`, `/expertValidate`, and `<html data-mobile-device>` (which `util.isMobile()` and e.g. `PanoMarker.js`
L176 branch on). Narrowing it sends every `iPad`-UA tablet to desktop Validate, which is
[#4875's Decision 1](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4875#issuecomment-5381905037)
("(a) at fold time, (b) as a fast-follow") and not this issue's call. So `isMobile` is **not** touched.

### 5.2 Recommended design: Explore stops bouncing anyone; the client decides

- `ExploreController.explore` (L56–72): delete the `isMobile` branch and `Visit_Audit_RedirectMobileLanding`
  (`getSession` L154–159 already logs the visit). Retire the event in `docs/logged-events.md` like
  `Visit_LabelMap_RedirectMobileLanding` (row at L275).
- `navbar.scala.html` L54–58: the Explore link is no longer gated on `isMobileDevice` (the other gates stay; they are
  #5665's other rows).
- **Shared with #5580:** `util.isTouchPrimary()` (the #5580 plan) is defined as `util.inputProfile().coarse` — one
  capability helper for both bundles; whichever plan lands first adds both.
- New shared helper **`util.inputProfile()`** in `common/utilities.js` (beside `util.isMobile`, whose comment already
  says "prefer a capability query"): `{ coarse: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover:
  hover)').matches, shortSide: Math.min(innerWidth, innerHeight), maxTouchPoints: navigator.maxTouchPoints }`, and
  `util.isSmallTouchScreen()` = `coarse && shortSide < 600`. One definition, used by Explore's entry and by #5665's other
  pages. (`data-mobile-device` stays what it is: "which UI variant the server served".)
- `pages/explore.js` entry, before `new Main(...)`: if `util.isSmallTouchScreen()` → reveal
  `#explore-small-screen-notice` (new markup in `explore.scala.html` inside `.tool-ui`, a `.ps-*` panel: "Labeling needs
  a larger screen. Try it on a tablet or computer. You can validate labels on your phone." + **Validate** link + **Continue
  anyway** button), log `Visit_Explore_SmallScreenNotice` through `window.logWebpageActivity` (no tracker exists yet) and
  **do not construct `Main`** (so no `StreetViewPanorama` is billed, [#5128](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5128)).
  "Continue anyway" logs `Click_module=ExploreSmallScreenContinue` and builds `Main`. Query string and URL survive, which
  is #5665's whole point. Copy in all locales.
- **Boundary rule (decided by Jon 2026-10-06): screen shape and size, never device class.** All three use
  `util.inputProfile()`; `shortSide = Math.min(innerWidth, innerHeight)`, threshold 600 CSS px (phones top out at
  ~430–480 on the short side; iPad mini 744, 8-inch Android tablets 600, Galaxy Fold inner 673).
  | Screen | Explore shows |
  |---|---|
  | `coarse` && portrait && `shortSide < 600` | **"Rotate your phone to label" screen** (hard gate, no Continue): link to Validate; `Main` not constructed. Listens for `orientationchange`/`matchMedia('(orientation: landscape)')` and dismisses itself live on rotate — the one deliberate exception to "fixed per load". Log `Visit_Explore_RotatePrompt`. |
  | `coarse` && landscape && `shortSide < 600` | The soft notice above ("works best on a larger screen" + Validate + **Continue anyway**). Proper landscape-phone layout and precision are [#5668](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5668), not this plan. |
  | everything else (tablets either orientation, desktops) | The tool. |
  There is no phone/tablet concept in code: name helpers by what they test (`util.isPortraitSmallTouch()`,
  `util.isSmallTouchScreen()`), keep 600 as one named constant, and tune it later from slice 1's telemetry.

If Jon prefers to land #5665 as its own PR first (Decision 1), this plan's slice 3 shrinks to: the helper, the navbar
gate, and a temporary `ExploreController` predicate `isPhoneUa` (= `isMobile && !UA.contains("iPad|Tablet") &&
!(Android && !Mobile)`, since Chrome/Firefox put `Mobile` only in phone UAs) — a stopgap that still trusts the UA and is
deleted when #5665 lands.

### 5.3 Tests

- `test/util/UserAgents.scala`: add `tablet` (an `iPad` UA) and `desktopIpad` (the Macintosh UA Safari sends — useful
  as documentation that it matches nothing).
- `test/controllers/ExploreTabletAccessSpec.scala` (new, `GuiceOneAppPerSuite` + `AnonSession`, pattern of
  `ExploreRoutesSpec`): `GET /explore` with the tablet UA and a session → 200, body contains `page-data` and
  `explore-small-screen-notice` markup (hidden), no `Location` header; with `UserAgents.mobile` → 200 as well under the
  recommended design (phones get the page + notice; the e2e phone profile proves the notice shows). `MobileDetectionSpec`
  unchanged — `data-mobile-device` still reflects `isMobile`.
- `ExploreSubmissionSpec` L193 environment JSON: add `max_touch_points`/`primary_pointer` and assert the row (L423
  query) carries them; a submission without them still inserts (nullable).
- e2e `test/e2e/explore-validate.spec.js`: a `test.describe('/explore on a tablet')` with
  `test.use(devices['iPad Pro 11'])` (UA contains `iPad`, `hasTouch: true`): `page.goto('/explore')` → `response.url()`
  ends in `/explore` (no redirect), tutorial loads (`#page-loading` hidden), no console errors, `#immersive-toggle-holder`
  hidden (tutorial), and `(await page.locator('#zoom-in-button').boundingBox()).height >= 44` if Playwright's touch
  emulation makes `(pointer: coarse)` match (verify; if it doesn't, assert only the load). A `PHONE_DEVICE` case asserts
  the notice is visible and `window.svl.panoViewer` is undefined. Still landing-state only, no pano interaction.

---

## 6. PR-sized slices, in dependency order

Each slice: `make scalafmt-fix` / `make compile` when Scala is touched, `make lint`, `make test-js`, the named specs,
`docs/logged-events.md` in the same PR for any event change. Branch names `5664-<slug>`.

### Slice 1 — Telemetry: touch capability in the environment tables (small)

Files: `conf/evolutions/default/<next>.sql` (§1.3); `app/models/audit/AuditTaskEnvironmentTable.scala` and
`app/models/validation/ValidationTaskEnvironmentTable.scala` (+2 fields, `Option[Int]`, `Option[String]`);
`app/formats/json/ExploreFormats.scala` L23–35 and `ValidateFormats.scala` L18–30 `EnvironmentSubmission`
(`maxTouchPoints: Option[Int]`, `primaryPointer: Option[String]`); `ExploreController.scala` L363–371 and the Validate
controller's equivalent mapping; `frontend/js/explore/data/Form.js` L149–161 and `frontend/js/validate/Form.js` env
object (`max_touch_points`, `primary_pointer`); `test/controllers/ExploreSubmissionSpec.scala` (+ the Validate submission
spec); `docs/logged-events.md` → "Environment metadata" paragraph.
Acceptance: evolution applies up/down on the dev DB; both specs green; a submission from a browser with
`maxTouchPoints > 0` lands with `primary_pointer = 'coarse'`. Appendix A Query D runs. **Run Queries A–C on prod
(read-only, per schema) in the same week and paste the numbers into the issue** — that is the gate.

### Slice 2 — Pointer Events input layer (medium; the core of the issue)

Files: new `frontend/js/explore/canvas/PointerInput.js`; `canvas/Canvas.js` (L36–41 status, L66–84 wiring, L195–279,
L326–346 handlers, `#canvasMousePosition` → takes `{clientX, clientY, currentTarget}`); `canvas/ContextMenu.js` L50–51,
L91–109; `onboarding/Onboarding.js` L1121–1129, L1223; `zoom/ZoomControl.js` (public `setZoom`, pinch logging);
`data/Tracker.js` L32–53; `pages/explore.js` (delete `enableTouchSupport`); `public/css/pages/explore/svl-canvas.css`
(§3.4); `docs/logged-events.md` (`LowLevelEvent_pointer*`, `Pinch_*` on Explore, `pointerType` note on
`ViewControl_MouseDown/Up`, `LabelingCanvas_MouseOut` mouse-only).
Tests (jest/jsdom; `loadModules`, stub `window.matchMedia`, stub `Element.prototype.setPointerCapture/releasePointerCapture`;
jsdom ≥ 22.1 has `PointerEvent` — if the suite's jsdom lacks it, add `test/js/support/pointerEvents.js` defining a
`MouseEvent` subclass carrying `pointerId/pointerType/isPrimary`):
- `test/js/explorePointerInput.test.js`: tap vs drag slop for touch/pen; mouse "every up is a tap"; pointer capture
  requested/released; `pointercancel` ends a drag without a tap; two-pointer pinch emits `zoomDelta = log2(d/d0)` and
  centroid deltas; `contextmenu` cancelled only after a touch pointerdown; `preventDefault` called on touch pointerdown
  and **not** on mouse.
- `test/js/exploreCanvasPointer.test.js` (pattern: `exploreContextMenuRerender.test.js` + `canvasCtxStub.js`): replaying
  the old mouse sequence (down/move/up on the view layer) produces identical `updatePov` calls and `ViewControl_*`
  events; a touch tap on the drawing layer creates exactly **one** label and logs one `LabelingCanvas_FinishLabeling`;
  a touch drag on the drawing layer pans and leaves the type armed; a mouse drag on the drawing layer does nothing.
- `test/js/exploreContextMenuPointerClose.test.js`: `pointerdown` outside closes (`ContextMenu_CloseClickOut`), inside
  doesn't.
Acceptance: all existing `test/js/explore*` suites green unchanged (mouse path pinned); `make lint`; desktop manual
smoke per the checklist in §9.2 (mouse only); real-iPad checklist §9.3 items 1–8.

### Slice 3 — Serve tablets: boundary helper, no redirect, phone notice (small–medium; closes #5665's Explore row)

Files: `app/controllers/ExploreController.scala` L56–72; `app/views/common/navbar.scala.html` L54–58;
`app/views/apps/explore.scala.html` (notice markup, inside `.tool-ui` above `#svl-application-holder`);
`frontend/js/common/utilities.js` (`inputProfile`, `isSmallTouchScreen`); `frontend/js/pages/explore.js` (notice branch);
`public/css/pages/explore/svl.css` (notice styles, `svl-` prefix); `public/locales/*/audit.json` (7 locales + overlays;
`make lint` parity); `docs/logged-events.md` (retire `Visit_Audit_RedirectMobileLanding`, add the two notice events);
`docs/architecture.md` "Mobile detection" paragraph (Explore is served to everyone; the notice is capability-selected);
tests per §5.3. Coordinate the issue thread: comment on #5665 that its Explore row is done here.
Acceptance: Scala specs green; e2e tablet + phone cases green; an iPad with an `iPad` UA reaches the tutorial.

### Slice 4 — Touch affordances and immersive default (medium)

Files: `public/css/main.css` (`--target-min-touch` token); `css/components/pano-overlay-buttons.css`,
`css/components/tag-pills.css`; `css/pages/explore/svl-context-menu.css`, `svl-ribbon.css`, `svl-minimap.css`,
`svl-alert.css`, `svl-immersive.css` (§4.2, §4.4); `frontend/js/common/utilities.js` (`LABEL_MIN_SCREEN_TARGET_TOUCH`,
`labelHitMargin`); `frontend/js/common/ImmersiveMode.js` (§4.3, tri-state storage, `source: 'capability'`);
`frontend/js/explore/Main.js` L285–299 (pass `defaultActive`), L729–748 (orientation note, menu re-anchor, keyboard
guard); `canvas/ContextMenu.js` (`reanchor()`); `menu/RibbonMenu.js` (tap-to-open Other under `hover: none`);
`alert/KeyboardShortcutAlert.js`, `alert/ZoomShortcutAlert.js` (gate); `frontend/js/common/psTooltip.js` L385 (hover gate;
remove the now-redundant strip in `validate/Main.js` L189–191); `explore.scala.html` L642 (`enterkeyhint`,
`autocapitalize`); `public/locales/*/common.json` (`immersive-exit-hint-touch`); `docs/logged-events.md`
(`ImmersiveMode_Restored` `source: capability`, `Window_Resized` notes on Explore, `Click_SubcategoryMenu_Open`);
`docs/accessibility.md` "Tool UIs" paragraph (touch targets and hover gating).
Tests: extend `test/js/immersiveMode.test.js` (capability default on/off, stored `'0'` beats the default, URL beats
stored-off? — no: stored wins over URL today, keep that order and pin it); `test/js/exploreRibbonOtherTouch.test.js`;
`test/js/psTooltipHoverGate.test.js`; `test/js/exploreLabelHitMargin.test.js` (44 under coarse, 24 otherwise);
`test/js/exploreShortcutAlertsGate.test.js`. CSS floors: Stylelint only, plus the e2e tablet bounding-box assertion.
Acceptance: §9.3 items 9–18 on a real iPad in both orientations.

### Slice 5 — Tutorial copy and the severity examples on touch (small, optional)

Files: `public/locales/*/audit.json` (touch variants of `onboarding.label-attribute-*` "click" → "tap",
`adjust-heading-angle-*` "grab and drag" is fine, `label-too-far-end` → "Tap the label, then Delete", `zoom-in`/`zoom-out`
without the key hint, `select-label-type-8/9` without "press {{key}}"); `onboarding/OnboardingStates.js` picks the
`-touch` key under `(hover: none)`; `ContextMenu.js` severity info icon pinnable with the three example images.
Acceptance: tutorial completes on an iPad with no step that names a mouse or key; e2e tutorial load unchanged.

### Slice 6 — Follow-ups filed, not built here

`FunnelStatTable` device CTE could use `max_touch_points` (analytics-only; Jon's call). `#5580` inherits
`PointerInput`, the token, the psTooltip gate and the environment columns. Phone-landscape experiment: §7.

---

## 7. The later phone-landscape experiment: what this gives for free, what's left

Now tracked as [#5668](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5668). Item (3) below is settled: portrait gets the rotate prompt (§5.2).

Free after slices 1–4: the pointer layer (tap/drag/pinch, no double-fire), 44 px floors, immersive-by-capability,
rotation and keyboard handling, the boundary helper (the experiment is `isSmallTouchScreen` returning false for
landscape phones behind a flag), the tutorial's pointer wiring, and `primary_pointer`/`max_touch_points` to measure it.

Left: (1) **precision** — a fingertip covers ~40 px and a curb ramp at zoom 1 on a 390-px-tall pano is ~10 px; the
honest answers are a magnifier/offset cursor on `pointerdown` in labeling mode (place on release, show a loupe above the
finger) or forcing zoom ≥ 2 while a type is armed — a design study, not a port; (2) **layout** under 600 px short side:
`applyToolScale` immersive hits `MIN_SCALE 0.65` on height (584 × 0.65 = 380 ≈ a landscape phone's 390), so circles are
43 px and pills unreadable — the strip needs a two-row or scrolling variant, the minimap a collapsed-button state, the
context menu (380 px × scale) a sheet; (3) **portrait**: block with a rotate prompt or a portrait strip; (4) **memory**:
`PannellumViewer`'s 8192 cap keys on `util.isMobile()` (architecture.md "Media storage"), which is false on a Mac-UA
tablet — Explore doesn't use Pannellum, but Validate on an iPad will, so #5580 should key it on `inputProfile` +
`deviceMemory` rather than UA; (5) iOS background-kill telemetry (`Validate_UnexpectedUnload`'s pattern) for Explore.

---

## 8. Decisions that need Jon (ALL RESOLVED — see "Decisions resolved" at the top)

1. **Sequencing with #5665.** (A) Land #5665 (all five pages, the notice component) first, then this plan's slice 3 is
   trivial; (B) this plan's slice 3 implements the Explore row of #5665 (helper + notice + no redirect) and #5665 does
   the other four pages against the same helper; (C) stopgap `isPhoneUa` predicate for Explore only (UA-based,
   temporary). **Recommend B**: tablets are blocked on the redirect, the Explore notice is ~40 lines, and writing
   `util.inputProfile()` here fixes the boundary for #5665 rather than deriving it twice.
2. ~~The phone/tablet boundary~~ **RESOLVED (Jon, 2026-10-06):** no phone/tablet distinction; gate on shape + size
   (§5.2 table): portrait small touch screen → rotate prompt; landscape small touch screen → soft notice until
   [#5668](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/5668); everything else → the tool.
3. **Label-type strip on a tablet: keep the top-centre strip (with the narrow-width compaction in §4.4) vs move it to a
   bottom dock under `(pointer: coarse)`.** A bottom dock is in thumb reach and matches Validate's immersive dock, but
   it collides with the minimap card, diverges the two layouts, and the tutorial still teaches the boxed ribbon.
   **Recommend keep the top strip** for this phase; revisit with touch telemetry (tap positions from
   `LowLevelEvent_pointerdown` will show reach).
4. **Default immersive on `(pointer: coarse)`, remembered per tab once the user exits.** Alternative: stay boxed and
   let the user press the button. **Recommend default on**: the boxed layout at 0.70–0.96 scale on an iPad is the
   layout the issue says is wrong, and the exit is one 44 px button with a one-time hint.

(The schema addition in slice 1 and the psTooltip hover gate are routine and not listed as decisions; say so if either
should be.)

---

## 9. Risks and QA

### 9.1 Risks

- **Compat-event suppression on Safari.** The double-fire fix relies on `preventDefault()` on a touch `pointerdown`
  suppressing compat mouse events (spec L2 §11). WebKit implements Pointer Events since 13; verify on device (QA #1). If
  it doesn't hold, the fallback is a `touchend`-timestamp guard like `PanoMarker.js` L189–224 (`CLICK_AFTER_TOUCH_MS`).
- **`touch-action: none` on the whole `#user-control-layer`** also stops two-finger page scrolling over the pano, which
  is what we want, but on a non-immersive page the pano is 480 × scale tall and the page scrolls around it — fine, the
  rest of the page keeps `manipulation`.
- **Pointer capture + `--ui-scale` relayout** mid-gesture: coordinates are recomputed per event from the live rect, but
  a capture target that is re-rastered (`sizeCanvasToDisplay` resets the canvas bitmap, not the element) keeps capture.
  Only the immersive toggle relayouts, and it is a button. Low.
- **iOS focus auto-zoom** is the single most disruptive bug if missed (zooms the fixed layout and leaves it zoomed);
  the 16 px rule is non-negotiable.
- **GSV WebGL + Google Maps minimap + two DPR-2 canvases at window size** on an older iPad: `sizeCanvasToDisplay`
  allocates 2 × (1366×1024×4 B × DPR²) ≈ 45 MB for the two canvases at DPR 2 — fine on any iPad from 2018. Watch
  `PanoViewer_WebGLContextLost` after launch.
- **`(pointer: coarse)` on an iPad with a trackpad** flips to `fine`/`hover` — the mouse variant, by design; the
  immersive default then doesn't fire. Document it; don't special-case.
- **Chrome/Firefox on iPad** (WebKit underneath; Firefox iOS sends an `iPad` UA) and **Android tablets** (Chrome fires
  compat mouse events unconditionally) — the pointer path covers both; QA on one Android tablet if available.
- **Context menu inside `#interaction-area-holder` with `touch-action: none` on a sibling**: the menu itself must keep
  `touch-action: auto` (default) so its tag list can scroll on a short landscape viewport. Don't put the rule on the
  holder.
- **The tutorial on touch** still says "click"/"grab" until slice 5 and its drag step listens to GSV `pov_changed`
  directly (Onboarding.js L1004) — unaffected by the input change.
- **Analytics continuity**: `Visit_Audit_RedirectMobileLanding` stops; `LowLevelEvent_mousedown` volume from touch
  sessions drops to ~0 (pointer rows replace them). Both noted in `docs/logged-events.md`.

### 9.2 Desktop regression smoke (any developer, mouse only; the browser can't host a pano here, so do it on a laptop)

Place/rate/tag/describe/delete a label; drag-pan in Walk and confirm a drag in label mode does nothing; wheel zoom;
right-click over the pano still opens the browser menu; hover card appears/hides with the 200 ms grace; click-outside
closes the context menu; `F`, `Z`, `1–3`, tag letters, `Esc`, `Space` unchanged; immersive toggle; tutorial start to
finish. Check `audit_task_interaction` for one `LabelingCanvas_FinishLabeling` per placement and `cursorX` non-null on
`LowLevelEvent_mouseup`.

### 9.3 Real-iPad checklist (Safari default UA, and once with "Request Mobile Website"; landscape and portrait)

1. Tap to place while a type is armed → exactly **one** label and one `ContextMenu_Open`; check the interaction log.
2. Drag in Walk mode pans; lifting mid-pan leaves no "stuck" drag (next tap doesn't pan).
3. Drag while a type is armed pans and the type stays armed; a tap then places.
4. Pinch zooms the pano between zoom 1 and 3; zoom buttons sync their disabled state; `Pinch_*` events logged.
5. Double-tap on the pano does **not** zoom the page; pinch on the ribbon/minimap chrome still zooms the page (1.4.4).
6. Tap a placed icon → context menu; tap the pano outside it → closes (`ContextMenu_CloseClickOut`).
7. Long-press on the pano shows no callout/magnifier/selection; Apple Pencil taps place at the tip.
8. Tap the Other circle → subcategory popover opens, no mode switch; tap Occlusion → selected; tap elsewhere closes.
9. Every control under `(pointer: coarse)` measures ≥ 44 px (Safari Web Inspector → Elements → box model): zoom ±,
   immersive toggle, Stuck, chevron, Image/Sound/Feedback, severity segments, tag pills, Done/Delete/close, minimap
   buttons, alert buttons.
10. Focusing the description box does **not** zoom the page; Return closes the menu; the panel is visible above the
    keyboard in both orientations (if not: §4.6's `context-menu--keyboard` rule).
11. Rotate with the menu open: the panel re-anchors to its label, the pano repaints (no black frame), one
    `Window_Resized` with `rotated: true`.
12. First load after the tutorial lands in immersive (`ImmersiveMode_Restored` `source: capability`), hint says "tap";
    exit → reload stays boxed (`sessionStorage` `'0'`); `?immersive=1` still enters.
13. Portrait immersive: strip, Stuck and zoom stack don't overlap; minimap and compass message don't overlap.
14. No tooltip pins open after a tap (zoom, Stuck, info icons); focusing the speed-limit sign shows its text.
15. Share from the menu header opens the native share sheet.
16. Tutorial completes end to end by touch (Safari with the default UA); no step requires hover or a key.
17. "Request Mobile Website" (iPad UA): `/explore` serves the tool (slice 3), navbar shows Explore, Validate still goes
    to `/mobile` (unchanged).
18. `audit_task_environment` row: `operating_system = 'macOS'`, `max_touch_points = 5`, `primary_pointer = 'coarse'`,
    `avail_height = screen_height` (confirms the §1.2 heuristic for this device).
19. With a Magic Keyboard trackpad attached: hover card and tooltips return, immersive doesn't default on.
20. Memory: 20 minutes of labeling with the minimap open; no tab reload (`PanoViewer_WebGLContextLost` absent).

---

## Appendix A — Measurement SQL (read-only; run per city schema; never join ids across schemas)

```sql
-- Prefix every query with the schema (ids are per-schema; see CLAUDE.md "label_id is per-city"):
-- SET search_path TO sidewalk_seattle;   -- repeat per city, or wrap in a loop over pg_namespace 'sidewalk_%'

-- A. Lower bound on iPads reaching Explore on a Macintosh UA, from existing columns (last 180 days).
--    ipad_screen: the device's logical screen size (either orientation) is one no Mac ships.
--    no_menu_bar: macOS always subtracts the menu bar from screen.availHeight; iPadOS doesn't.
WITH env AS (
  SELECT audit_task_id, mission_id, operating_system, browser,
         (LEAST(screen_width, screen_height), GREATEST(screen_width, screen_height)) IN
           ((744,1133),(768,1024),(810,1080),(820,1180),(834,1112),(834,1194),(834,1210),(1024,1366),(1032,1376))
           AS ipad_screen,
         avail_height = screen_height AND avail_width = screen_width AS no_menu_bar
  FROM audit_task_environment
  WHERE timestamp >= now() - interval '180 days'
)
SELECT operating_system, ipad_screen, no_menu_bar,
       count(*) AS submissions, count(DISTINCT audit_task_id) AS tasks, count(DISTINCT mission_id) AS missions
FROM env
GROUP BY 1, 2, 3
ORDER BY submissions DESC;

-- B. How those sessions go: labels per task and completion, iPad-like macOS rows vs everything else.
--    Tutorial missions excluded (mission_type = 'auditOnboarding'); deleted labels excluded.
WITH cand AS (
  SELECT DISTINCT e.audit_task_id, e.mission_id,
         e.operating_system = 'macOS'
           AND e.avail_height = e.screen_height
           AND (LEAST(e.screen_width, e.screen_height), GREATEST(e.screen_width, e.screen_height)) IN
             ((744,1133),(768,1024),(810,1080),(820,1180),(834,1112),(834,1194),(834,1210),(1024,1366),(1032,1376))
           AS ipad_like
  FROM audit_task_environment e
  JOIN mission ON mission.mission_id = e.mission_id
  WHERE e.timestamp >= now() - interval '180 days'
    AND mission.mission_type <> 'auditOnboarding'
)
SELECT ipad_like,
       count(*) AS tasks,
       round(avg(audit_task.completed::int), 3) AS completion_rate,
       round(avg(labels.n), 2) AS labels_per_task,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY labels.n) AS median_labels
FROM cand
JOIN audit_task ON audit_task.audit_task_id = cand.audit_task_id
LEFT JOIN LATERAL (
  SELECT count(*) AS n FROM label WHERE label.audit_task_id = cand.audit_task_id AND label.deleted = false
) labels ON true
GROUP BY ipad_like;

-- C. iPads the UA regex bounced (iPad-UA Safari "Request Mobile Website", Firefox iOS, old iPadOS): never saw Explore.
SELECT date_trunc('month', timestamp) AS month, count(*) AS bounced_visits, count(DISTINCT user_id) AS users
FROM webpage_activity
WHERE activity = 'Visit_Audit_RedirectMobileLanding' AND timestamp >= now() - interval '180 days'
GROUP BY 1 ORDER BY 1;

-- D. After slice 1 ships: the gate number. Touch-primary share of Explore tasks, and how they go.
WITH t AS (
  SELECT DISTINCT e.audit_task_id, e.primary_pointer, e.max_touch_points > 0 AS has_touch
  FROM audit_task_environment e
  JOIN mission ON mission.mission_id = e.mission_id
  WHERE e.timestamp >= now() - interval '90 days'
    AND e.primary_pointer IS NOT NULL
    AND mission.mission_type <> 'auditOnboarding'
)
SELECT primary_pointer, has_touch,
       count(*) AS tasks,
       round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS pct_of_tasks,
       round(avg(audit_task.completed::int), 3) AS completion_rate,
       round(avg(labels.n), 2) AS labels_per_task
FROM t
JOIN audit_task ON audit_task.audit_task_id = t.audit_task_id
LEFT JOIN LATERAL (
  SELECT count(*) AS n FROM label WHERE label.audit_task_id = t.audit_task_id AND label.deleted = false
) labels ON true
GROUP BY 1, 2 ORDER BY tasks DESC;

-- The same four queries run unchanged against validation_task_environment (mission_id is nullable there; drop the
-- audit_task join and count label_validation rows per mission instead) for #5580.
```

Column names used: `audit_task_environment(audit_task_id, mission_id, timestamp, operating_system, browser,
screen_width/height, avail_width/height, max_touch_points*, primary_pointer*)`, `audit_task(audit_task_id, completed)`,
`mission(mission_id, mission_type)`, `label(audit_task_id, deleted)`, `webpage_activity(activity, timestamp, user_id)`.
Verify `label.deleted` and `audit_task.completed` spellings against the schema before running (`\d label` as
`readonly_user` on the dev DB); the starred columns exist only after slice 1.

## Appendix B — Files touched, by slice (quick index)

| Slice | Scala | Views | JS | CSS | Locales/docs | Tests |
|---|---|---|---|---|---|---|
| 1 | evolution; `AuditTaskEnvironmentTable`, `ValidationTaskEnvironmentTable`; `ExploreFormats`, `ValidateFormats`; `ExploreController` L363–371 + Validate equivalent | — | `explore/data/Form.js` L149–161, `validate/Form.js` | — | logged-events "Environment metadata" | `ExploreSubmissionSpec`, Validate submission spec |
| 2 | — | — | new `canvas/PointerInput.js`; `Canvas.js`; `ContextMenu.js`; `Onboarding.js`; `ZoomControl.js`; `Tracker.js`; `pages/explore.js` | `svl-canvas.css` | logged-events | `explorePointerInput`, `exploreCanvasPointer`, `exploreContextMenuPointerClose` |
| 3 | `ExploreController` L56–72 | `navbar.scala.html` L54–58; `explore.scala.html` notice | `common/utilities.js`; `pages/explore.js` | `svl.css` | 7 locales `audit.json`; logged-events; architecture.md | `UserAgents`, `ExploreTabletAccessSpec`, e2e tablet/phone |
| 4 | — | `explore.scala.html` L642 | `ImmersiveMode.js`; `Main.js`; `ContextMenu.js`; `RibbonMenu.js`; alerts; `psTooltip.js`; `utilities.js`; `validate/Main.js` L189–191 | `main.css` token; `pano-overlay-buttons.css`; `tag-pills.css`; `svl-context-menu.css`; `svl-ribbon.css`; `svl-minimap.css`; `svl-alert.css`; `svl-immersive.css` | `common.json`; logged-events; accessibility.md | `immersiveMode` (ext), ribbon/tooltip/hit-margin/alert gates |
| 5 | — | — | `OnboardingStates.js`; `ContextMenu.js` | `svl-context-menu.css` | `audit.json` ×7 | — |
