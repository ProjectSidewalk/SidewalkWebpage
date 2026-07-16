# Logged interaction events

Project Sidewalk records fine-grained **user-interaction events** (clicks, key presses, mode switches, pano changes,
mission/task events, …) so we can analyze how people use the tools and debug sessions. This page explains how that
logging works and documents the events whose meaning isn't obvious from their name — then points you at the code for
the authoritative, always-current list.

> **Why this page is deliberately not an exhaustive table.** The authoritative list of events *is the code* — events
> are emitted by `push(...)` calls across the frontend, and some names are assembled at runtime. A hand-maintained
> mirror of every event drifts (the previous wiki version did: it still listed `GSVInfo*` events that were renamed,
> and events that no longer fire). So this page documents the *system* and the *non-obvious* events, and defers
> completeness to [Finding the current list](#finding-the-current-list). When you add or change an interaction, update
> the relevant section here in the **same PR** — the [PR template](../.github/PULL_REQUEST_TEMPLATE.md) reminds you.

## How logging works

Each interactive tool has its own `Tracker` that buffers events and periodically flushes them to a backend table:

| Tool | Tracker (frontend) | Backend table | Table model (Slick) |
|------|--------------------|---------------|---------------------|
| **Explore / Audit** (`explore`) | `public/js/explore/src/data/Tracker.js` | `audit_task_interaction` | `app/models/audit/AuditTaskInteractionTable.scala` |
| **Validate** (`validate`, incl. mobile) | `public/js/validate/src/Tracker.js` | `validation_task_interaction` | `app/models/validation/ValidationTaskInteractionTable.scala` |
| **Gallery** (`gallery`) | `public/js/gallery/src/data/Tracker.js` | `gallery_task_interaction` | `app/models/gallery/GalleryTaskInteractionTable.scala` |

The core call is **`tracker.push(action, note)`** (see `Tracker.push` in each Tracker file):

- `action` — the event name (a string; see [naming](#event-naming)).
- `note` — an optional object of extra fields (e.g. `{labelType}`, `{cursorX, cursorY}`, `{keyCode}`) stored with the
  event.

Each pushed event is buffered with a timestamp and context (pano, task, lat/lng, …) and flushed to the backend
periodically — on mission complete or after enough interactions accumulate — which is itself recorded as a
`RefreshTracker` event.

**Environment metadata (separate from events).** Alongside interaction events, each tool's `Form.js` submits
per-session environment fields — including `browser`, `browser_version`, and `operating_system` — stored with the task
rather than as `push(...)` events. These values come from the **Bowser** library (`util.getBrowser` /
`getBrowserVersion` / `getOperatingSystem` in `common/Utilities.js`). Historical rows, produced by jQuery user-agent
sniffing, use a different vocabulary (`mozilla` for Firefox, `MacOS`, `UNIX`); newer rows use Bowser's (`Firefox`,
`macOS`, `Linux`, …). When analyzing browser/OS across time ranges, expect both.

### Page-level activity (`webpage_activity`)

Separate from the per-tool trackers, a lighter path records **page visits and one-off actions** on pages that aren't
the labeling tools (dashboards, leaderboard, settings, API docs, admin, …). These land in the **`webpage_activity`**
table (`app/models/utils/WebpageActivityTable.scala`) rather than the interaction tables above:

- **Backend** — a controller calls `LoggingService.insert(userId, ipAddress, activity)` (`app/service/LoggingService.scala`),
  typically once per request to mark a page view or a server-handled action.
- **Frontend** — `window.logWebpageActivity(activity)` (set up in `common/AppManager.js`) POSTs to
  `/userapi/logWebpageActivity` for client-side clicks.

Two naming conventions dominate here: **`Visit_<Page>`** for a page view (e.g. `Visit_UserDashboard`,
`Visit_Leaderboard`, `Visit_Settings`, `Visit_PublicProfile` — the dashboard/leaderboard names carry over from the
pre-redesign pages, so per-page analytics stay continuous across the #4474 cutover) and **`Click_module=<Action>`** for
a discrete action (e.g. `Click_module=SaveSettings`, `Click_module=CreateTeam`, `Click_module=MistakeVote_agrees=<bool>`, `Click_module=MistakeNote`).
Follow these when adding a page or action. The landing page's validation grid logs
`View_module=LandingValidationGrid_labelCount=<n>` when the grid first loads (it's below the fold and lazy-loaded, so
this marks the grid actually being seen, not just the page view) and
`Click_module=LandingValidationGrid_result=<Agree|Disagree|Unsure>_labelId=<id>` per vote; the vote itself lands in
`label_validation` with `source = 'LandingPage'`. Opening a card's "what is this label type?" tooltip logs
`Click_module=LandingValidationGridInfo_labelType=<type>`, once per card. Clicking a card's share chip logs
`Click_module=LandingValidationGridShare_labelId=<id>` (surface + label attribution) alongside ShareWidget's own
generic `Share_*` events. The current set lives in the code — grep the controllers:

```bash
grep -rhoE 'loggingService\.insert\([^)]*"[^"]+"' app/controllers | grep -oE '"[^"]+"$' | sort -u
```

## Event naming

Most events are fixed, transparently-named strings (`ContextMenu_Open`, `Onboarding_Start`, `Click_ZoomIn`). The ones
worth knowing about are the **families assembled at runtime**, which you won't find as full string literals:

- **`LowLevelEvent_<domType>`** — raw DOM events. `Tracker.trackWindowEvents()` (in
  `explore/src/data/Tracker.js`) binds `mousedown`, `mouseup`, `mouseover`, `mouseout`, `mousemove`, `click`,
  `contextmenu`, `dblclick`, `keydown`, `keyup` and pushes `"LowLevelEvent_" + e.type`, with `cursorX`/`cursorY` or
  `keyCode` in the note.
- **`ModeSwitch_<LabelType>`**, **`Click_ModeSwitch_<LabelType>`**, **`KeyboardShortcut_ModeSwitch_<LabelType>`** —
  labeling-mode changes; suffix is the label type (`CurbRamp`, `NoSidewalk`, …) or `Walk`. The prefix encodes *how*
  the switch happened: programmatic vs. a mouse click (emitted in `explore/src/menu/RibbonMenu.js`) vs. a keyboard
  shortcut (`explore/src/keyboard/Keyboard.js`).
- **`Click_Subcategory_<Subcategory>`**, **`KeyboardShortcut_Severity_<n>`** — suffix is the chosen subcategory /
  severity value (also `RibbonMenu.js` / `Keyboard.js`).

Conventions for new events: `PascalCase_WithUnderscores`, prefixed by UI area or mechanism (`ContextMenu_…`,
`KeyboardShortcut_…`, `PopUpShow_…`, `Modal…_…`). Keep `Click_…` for mouse and `KeyboardShortcut_…` for the keyboard
equivalent so the two input paths stay distinguishable in analysis.

## Notable events

Most event names are self-explanatory; for the full set, [read the code](#finding-the-current-list). These are the
ones whose meaning, parameters, or history aren't obvious:

| Event | Why it's worth noting |
|-------|------------------------|
| `RefreshTracker` | Not a user action — it marks the buffer being flushed to the backend (on mission complete or after N interactions). |
| `SubmitFailed` / `SubmitFailedGaveUp` (Validate) | Not user actions — a data POST to `/validationTask` failed and is being retried (`SubmitFailed`, with `attempt` and `error`) or was abandoned after the retry cap (`SubmitFailedGaveUp`). Surfaces flaky-network submission trouble, esp. on mobile (#2745). |
| `POV_Changed` (Validate) | The user panned/zoomed the pano. Throttled to at most one per ~500ms (with a trailing sample) so a continuous drag no longer floods the buffer (#2745) — counts undercount raw movement by design. |
| `LowLevelEvent_<domType>` | A runtime family, not a single event (see [naming](#event-naming)); these are by far the highest-volume rows. |
| `ModeSwitch_<…>` vs `Click_ModeSwitch_<…>` vs `KeyboardShortcut_ModeSwitch_<…>` | Same logical action via three input paths; don't double-count them as separate behaviors. |
| `LabelingCanvas_FinishLabeling` | A label was *placed* (severity/tags not yet set, and it can still be removed) — not a finalized label. |
| `ContextMenu_Close` + `ContextMenu_CloseButtonClick` / `CloseClickOut` / `CloseKeyboardShortcut` / `ClosePressEnter` | The menu close is logged generically *and* by mechanism; pick the granularity your analysis needs. |
| `ContextMenu_TagAutoRemoved` | A tag the system removed automatically (e.g. incompatible with a changed label), distinct from a user-removed tag. |
| `PanoInfoButton_Click` / `PanoInfoCopyToClipboard_Click` / `PanoInfoViewInPano_Click` | **Renamed from `GSVInfo*`** with the pano-viewer abstraction — older data uses the `GSVInfo*` names, so query both across time ranges. |
| `NeighborhoodComplete_ByUser` vs `NeighborhoodComplete_AcrossAllUsers` | One user finishing their work vs. a neighborhood hitting 100% across *all* users. |
| `Viewer_Primary` / `Viewer_Pannellum` | Which imagery viewer is active — the primary provider vs. the Pannellum fallback. |
| `KeyboardShortcut_DisagreeReason_Option` / `KeyboardShortcut_UnsureReason_Option` | Validate: a reason chosen for a disagree/unsure verdict. |
| `KeyboardShortcut_MoveForwardAlongRoute` | Explore: the spacebar route-advance shortcut. The `usedRoute` note is `false` when it stepped to a GSV-linked pano and `true` when it fell back to the same route-aware engine as the Stuck button (so heavy `usedRoute:true` volume overlaps with `ModalStuck_*`). |
| `ValidationOptionApply` / `ValidationOptionUnapply` (Gallery) | A validation-status **filter** in the Gallery — *not* a validation of a label. |
| `Visit_SharedLabel=<labelId>` | Server-logged (not via a `Tracker.js`) in `ShareController.label` when the public `/label/:id` share page is loaded; the suffix is the shared label id. |
| `Visit_Welcome` | Server-logged in `UserController.welcome` when the post-registration `/welcome` page renders (#4375); every fresh registration lands there, so its volume tracks completed sign-ups. |
| `ServiceHours_Set=<bool>` | Server-logged in `UserController.setServiceHours` when a user opts in to (`true`) or out of (`false`) official community-service-hour recognition from the `/welcome` callout or the `/serviceHoursInstructions` toggle (#4375). |
| `Share_Click` / `Share_Native` / `Share_CopyLink` / `Share_Platform=<Twitter\|Facebook\|Email>` | Emitted by the frontend share widget: opening the share UI, invoking the native OS share sheet, copying the permalink, and sharing to a named platform (the `Share_Platform` suffix is the target). |
| `Click_module=SharedLabel_target=<FullMap\|Explore\|Validate\|NearbyLabel>` | Outbound/interactive clicks on the public spotlight page (`SharedLabel.js`): `FullMap` = the "explore the full map" caption link into the LabelMap, `Explore`/`Validate` = the call-to-action buttons into those tools, `NearbyLabel_labelId=<id>` = clicking a nearby-labels map marker (the suffix is that neighbor's label id). |
| `Click_module=LabelDetail_action=<PanoInfoButton\|PanoInfoCopyToClipboard\|PanoInfoViewInPano\|ViewOnLabelMap\|ExploreHere>_labelId=<id>` / `Click_module=LabelPopup_action=<NextLabel\|PrevLabel>_labelId=<id>` | The shared Label Detail Card (#4572) on its `webpage_activity`-logged hosts (LabelMap, Gallery, dashboards, admin, share page): opening the Details popover, its copy-to-clipboard and view-in-provider actions, the "View on Label Map" hop, the "Explore the sidewalks here" hop into a free-exploration Explore session seeded at the label's pano + POV (#4637), and the popup's prev/next nearby-label arrows (`labelId` is the shown label; the arrows log the label paged *from*). On Explore/Validate the same popover logs through those tools' trackers as `PanoInfo*_Click` instead. |
| `Click_module=StorySectionExpand_labelId=<id>` / `Click_module=StoryComposerOpen_labelId=<id>` / `Click_module=StoryEditOpen_storyId=<id>` / `Click_module=StorySignInCta_labelId=<id>` / `Click_module=StoryPhotoEnlarge_storyMediaId=<id>` / `Click_module=StoryDashboardLink_labelId=<id>` | Lived-experience stories on the label-detail card (#4054): expanding the stories disclosure, opening the composer dialog (blank or prefilled for an in-place edit), clicking the composer's sign-in CTA (stashes the in-progress draft, then bounces to `/signIn`), enlarging a story photo into the lightbox, and following the own-story "See all your stories" link to the dashboard. Client-logged from `StorySection.js`/`StoryComposer.js`. |
| `Click_module=StorySubmit_labelId=<id>_hasPhoto=<bool>` vs `Click_module=StorySubmitClient_…` | Story submission is logged twice: server-side in `StoryController.submitStory` on every attempt (`StorySubmit`, before validation — includes rejected attempts) and client-side only on success (`StorySubmitClient`). The gap between the two counts rejected/failed submissions. |
| `Click_module=StoryUpdate_storyId=<id>_hasPhoto=<bool>` vs `Click_module=StoryUpdateClient_storyId=<id>` | An in-place story edit, mirroring the submit pair: server-logged on every PUT attempt (including rejections and a non-owner's 404), client-logged on success. `hasPhoto` marks whether the edit uploaded a replacement photo. |
| `Click_module=StoryDelete_storyId=<id>` vs `Click_module=StoryDeleteClient_…` | A story retraction: server-logged on every DELETE attempt (including a non-owner's 404), client-logged when the confirm dialog is accepted on the card or dashboard. |
| `Click_module=AdminStoryVisibility_storyId=<id>_hidden=<bool>` / `Click_module=AdminStoryDelete_storyId=<id>` | Server-logged admin moderation actions on `/admin/stories`: hide/unhide (reversible quarantine) and permanent delete. |
| `TutorialIntro_Start` / `TutorialIntro_Next` / `TutorialIntro_StartMission` / `TutorialIntro_Skip` | The pre-tutorial intro walkthrough shown before the Explore onboarding (`explore/src/onboarding/TutorialIntro.js`): shown, advanced a step (`step` note = new index), finished into the tutorial, or skipped. `TutorialIntro_Skip` precedes the same `Onboarding_Skip` the onboarding itself emits, so a skip logs both. |
| `Click_module=ExploreSidewalksHere_lat=<lat>_lng=<lng>` | LabelMap: the "Explore the sidewalks here" popup button after an address search (#4451) — an outbound click into the free-exploration Explore session at those coordinates. |
| `Visit_Audit_ExploreAddress_Lat=<lat>_Lng=<lng>` | Server-logged in `ExploreController.explore` when `/explore?lat&lng` opens a free-exploration (exploreAddress) session at a searched address (#4451). |
| `ExploreAddress_SessionStart` | Explore (`audit_task_interaction`): the free-exploration UI finished loading. Sessions under the `exploreAddress` mission type label normally but never complete tasks/missions, so don't mix them into street-completion or mission-funnel analyses. |
| `RouteBuilder_Click=OpenSaveModal` / `SignInToSave` / `ContinueAsGuest` | The RouteBuilder save flow (#3343): opening the name-your-route modal, choosing to sign in before saving (the route is stashed and restored after the sign-in reload), or saving as a guest. `SaveSuccess_RouteId=<id>` / `SaveError` mark the POST's outcome, as before the redesign. |
| `RouteBuilder_Click=RecoverGuestRoute[_Copy]_RouteId=<id>` | A guest reopened (`RecoverGuestRoute`) or re-copied the link of (`_Copy`) a previously saved route from the device-local "Your recent routes" panel. |
| `Click_module=RouteList_<Explore\|LabelMap\|Copy\|Rename\|Delete>_RouteId=<id>` | Actions on a saved route in the dashboard's "My Routes" section (`MyRoutes.js`). |

## Finding the current list

The reference above is intentionally partial. To get the **authoritative, current** set for a tool, search its
`src/` for `push(` and read the surrounding code (remember the [runtime families](#event-naming) won't appear as full
literals):

```bash
# Literal event names emitted by the Explore tool (swap in validate/src or gallery/src for the others):
grep -rhoE "push\(\s*['\"][A-Za-z0-9_]+" public/js/explore/src --include=*.js | sort -u
```

Then read each tool's `Tracker.js` for the generated families (start with `trackWindowEvents()` in
`explore/src/data/Tracker.js`), and `explore/src/menu/RibbonMenu.js` + `explore/src/keyboard/Keyboard.js` for the
`ModeSwitch_`/`Severity_`/`Subcategory_` suffixes. The backend table models (table above) define the columns each
event is stored in.

## Keeping this up to date

- **Add or change an interaction → update the relevant section here in the same PR.** The
  [PR template](../.github/PULL_REQUEST_TEMPLATE.md) includes this step.
- Follow the [naming conventions](#event-naming); if you add a keyboard path for an existing click (or vice versa),
  mirror the existing `Click_…` / `KeyboardShortcut_…` pair so the input paths stay distinguishable.
- Only document a *new* event here if its meaning isn't obvious from its name — keep this page the curated layer over
  the code, not a mirror of it.
- Unsure whether or how something should be logged? Ask Mikey.
