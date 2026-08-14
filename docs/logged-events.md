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
periodically — on mission complete, after enough interactions accumulate, or (in Validate) roughly a minute after the
first interaction since the last flush (#4429) — which is itself recorded as a `RefreshTracker` event.

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
generic `Share_*` events.

The shared map filter sidebar (`ps-map/MapSidebarFilter.js`, rendered on LabelMap, the admin maps, and the user
dashboard/profile maps) logs its interactions here as the **`Click_module=MapSidebar_<Action>`** family. The `<Action>`
vocabulary mirrors the Gallery filter events (`SeverityApply`, `TagApply`, `ValidationOptionApply`, … in
`gallery_task_interaction`) so filter behavior can be compared across the two tools:
`MapSidebar_SeverityApply_severity=<null|1|2|3>` / `…Unapply…`, `MapSidebar_LabelTypeApply_labelType=<type>`,
`MapSidebar_ValidationOptionApply_option=<correct|incorrect|unsure|unvalidated>`,
`MapSidebar_TagApply_labelType=<type>_tag=<tag>`, `MapSidebar_StreetApply_street=<audited|unaudited>` (each with an
`Unapply` twin), `MapSidebar_SelectAll_section=<…>` / `…DeselectAll…`, `MapSidebar_Only_section=<…>_value=<…>`,
`MapSidebar_NotAdminValidated_checked=<bool>`, and `MapSidebar_Open` / `MapSidebar_Close`. These fire on every page
that renders the sidebar; use the accompanying page-visit events to segment by page.

The LabelMap's "Download" control (`ps-map/MapDownloadControl.js`, #4095) logs the
**`Click_module=MapDownload_<Action>`** family: `MapDownload_Open` when the panel opens,
`MapDownload_Download_format=<geojson|csv|shapefile|geopackage>` when a format is picked (the download itself is a
`/v3/api/rawLabels` request, so it also appears in the API request log), and `MapDownload_DocsLink` when the panel's
API-documentation link is followed.

The Gallery renders the same sidebar (`gallery/src/filter/GalleryFilter.js`) and logs to `gallery_task_interaction`
under its own names, one `<Section>Apply` / `<Section>Unapply` pair per section with the toggled value in the notes:
`LabelTypeApply` with `Label_Type:<type>`, `SeverityApply` with `Severity:<null|1|2|3>`, `ValidationOptionApply` with
`ValidationOption:<option>`, and `TagApply` with `Tag:<tag>,Label_Type:<type>`. The batch affordances follow the same
stems — `LabelTypeOnly` / `SeverityOnly` / `ValidationOptionOnly` (same notes) and `<Section>SelectAll` /
`<Section>DeselectAll`. Two events appear only in older data: `Filter_LabelType=<type>`, from when the Gallery showed
one label type at a time, and `Filter_City=<url>`, from before the navbar's city picker.
Outside the sidebar, a card's neighborhood name logs `CardLocationClick` with a `Region_Id:<id>` note when it
takes the viewer to that neighborhood on the LabelMap.

The current set lives in the code — grep the controllers:

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
| `RefreshTracker` | Not a user action — it marks the buffer being flushed to the backend (on mission complete, after N interactions, or — in Validate — on a ~60s deadline after the first unflushed interaction). |
| `SubmitFailed` / `SubmitFailedGaveUp` (Validate) | Not user actions — a data POST to `/validationTask` failed and is being retried (`SubmitFailed`, with `attempt` and `error`) or was abandoned after the retry cap (`SubmitFailedGaveUp`). Surfaces flaky-network submission trouble, esp. on mobile (#2745). |
| `POV_Changed` (Validate) | The user panned/zoomed the pano. Throttled to at most one per ~500ms (with a trailing sample) so a continuous drag no longer floods the buffer (#2745) — counts undercount raw movement by design. |
| `LowLevelEvent_<domType>` | A runtime family, not a single event (see [naming](#event-naming)); these are by far the highest-volume rows. |
| `ModeSwitch_<…>` vs `Click_ModeSwitch_<…>` vs `KeyboardShortcut_ModeSwitch_<…>` | Same logical action via three input paths; don't double-count them as separate behaviors. |
| `LabelingCanvas_FinishLabeling` | A label was *placed* (severity/tags not yet set, and it can still be removed) — not a finalized label. |
| `Click_LabelHoverCard` | Explore (#4719): a placed label's hover card was clicked, opening its context menu — the card is a large click target for the same action as clicking the label icon, so its volume overlaps `ContextMenu_Open`. Notes carry the label's `labelType` and `via` (`edit-button` for the card's Edit button, `card` for a click anywhere else on it). `Click_LabelDelete` fires from the card's Delete button (same event name as before the card existed). |
| `Click_LabelCardShare` | The share button in a label panel's header (#4726) — Explore's hover card, the context menu it opens into, and Validate's card. Fires only on the click that *opens* the share menu, never on the one that dismisses it; the `labelType` note carries the label's type on all three. It always precedes a `Share_Click` from `ShareWidget` itself, so the two overlap by design — this one says *which surface* the share started from, which `Share_Click` alone can't tell you. Neither implies anything was actually shared: `Share_CopyLink` / `Share_Platform=<…>` / `Share_Native` are the events that mean a link left the page. |
| `MouseOver_Label` (Validate) | The label card opened over the label being validated. Since #4726 it fires once per opening rather than on every pointer re-entry while the card is already up, so counts run below the pre-#4726 era's — and on mobile it now fires on the marker *tap* that opens the card, where the touch path used to log nothing. Read it as "the card was opened", not as a mouse hover. Since #4729 it means the *pointer or touch* path only: keyboard opens log `KeyboardShortcut_ShowLabelCard` instead. |
| `KeyboardShortcut_ShowLabelCard` / `KeyboardShortcut_HideLabelCard` (Validate) | The same label card opened and closed from the keyboard (#4729) — Tab onto the label's marker or Enter/Space on it to open, Escape to close. The pointer equivalents are `MouseOver_Label` and no event at all (a card that times out when the cursor leaves logs nothing), so these two don't balance: expect far fewer hides than shows. The hide fires only when a card was actually up, so Escape pressed against nothing doesn't inflate it. Desktop only — mobile Validate builds no `KeyboardManager`. |
| `Click_HideLabel` / `Click_UnhideLabel` (Validate) | The label-visibility toggle, via pointer. Since #4726 **two** controls emit these under the same name — the always-visible pill in the pano's top-left and the toggle in the label card's footer — so they can't be told apart; only their combined volume is meaningful. The H key logs `KeyboardShortcut_HideLabel` / `_UnhideLabel` instead, so the two input paths do stay distinguishable. |
| `ContextMenu_DoneButtonClick` | **Renamed from `ContextMenu_OKButtonClick`** when the description field's inline OK became the panel footer's Done button (#4724) — same action, so query both across time ranges. |
| `ContextMenu_LabelDelete` | The context menu's own Delete button (#4724), which removes the label being edited. Distinct from `Click_LabelDelete`, which is the collapsed hover card's Delete; notes carry `labelType` on both. |
| `ContextMenu_Close` + `ContextMenu_CloseButtonClick` / `CloseClickOut` / `CloseKeyboardShortcut` / `ClosePressEnter` | The menu close is logged generically *and* by mechanism; pick the granularity your analysis needs. |
| `ContextMenu_TagAutoRemoved` | A tag the system removed automatically (e.g. incompatible with a changed label), distinct from a user-removed tag. |
| `PanoInfoButton_Click` / `PanoInfoCopyToClipboard_Click` / `PanoInfoViewInPano_Click` | **Renamed from `GSVInfo*`** with the pano-viewer abstraction — older data uses the `GSVInfo*` names, so query both across time ranges. |
| `NeighborhoodComplete_ByUser` vs `NeighborhoodComplete_AcrossAllUsers` | One user finishing their work vs. a neighborhood hitting 100% across *all* users. |
| `RouteFinishToast_Shown` / `RouteAutoComplete_Fired` | Explore route walking (#4579): the user reached their route's last reachable pano so the finish toast showed, then — once they panned ~360° there (`fractionObserved` ≥ 0.9) — completion auto-fired. The auto-fire replaces the old manual compass-click to complete a route; `fractionObserved` notes how much of the final pano was observed at fire time. |
| `Viewer_Primary` / `Viewer_Pannellum` | Which imagery viewer is active — the primary provider vs. the Pannellum fallback. |
| `LabelSkipped_NoImagery` (Validate) | Not a user action — neither the primary viewer nor the Pannellum fallback could render a label's pano, so the label was dropped from the mission without ever being shown (#4810). The `labelId` / `panoId` notes name the label that was dropped; the row's own `pano_id` column is the *previous* label's pano, since nothing new ever loaded. Causes range from expired imagery to a provider quota or a network blip, so a burst from one user reads differently than a steady trickle across many. |
| `LabelTopUp` / `LabelTopUpFailed` (Validate) | The follow-up to a `LabelSkipped_NoImagery`: the client asked `/validationTask/moreLabels` to replace what it dropped, so the mission can still reach its usual 10. `LabelTopUp` notes `requested` and `received` — `received: 0` means the backend had nothing left to give and the user was sent to the no-more-labels modal. `LabelTopUpFailed` (with `error`) is the request itself failing. Neither fires without a preceding drop, and they are capped at two rounds per mission, so a run of them marks broad imagery trouble rather than one bad label. |
| `Click_ImageryUnavailableModal_Retry` (Validate) | The Try Again button on the modal shown when Validate gave up because it couldn't load imagery — distinct from `Click_NoMoreMissionModal_Audit`, which is the same button when there genuinely are no labels left (that one leaves for Explore; this one reloads Validate). |
| `KeyboardShortcut_DisagreeReason_Option` / `KeyboardShortcut_UnsureReason_Option` | Validate: a reason chosen for a disagree/unsure verdict. |
| `KeyboardShortcut_MoveForwardAlongRoute` | Explore: the spacebar route-advance shortcut. The `usedRoute` note is `false` when it stepped to a GSV-linked pano and `true` when it fell back to the same route-aware engine as the Stuck button (so heavy `usedRoute:true` volume overlaps with `ModalStuck_*`). |
| `Click_RouteForwardArrow` / `RouteForwardArrow_Success` / `RouteForwardArrow_PanoNotAvailable` | Explore: the on-pano forward arrow highlights the route direction (#4671) — usually a recolored link arrow (which logs as a normal move), but where the link graph offers no arrow along the route a blue arrow is *synthesized*, and clicking **that** one logs this event and runs the same route-aware `moveForward()` as the compass's "straight" and the Stuck button. So it fires only at link-graph dead-ends, and its volume overlaps `CompassMove_*` / `ModalStuck_*` / `KeyboardShortcut_MoveForwardAlongRoute` (`usedRoute:true`). |
| `ValidationOptionApply` / `ValidationOptionUnapply` (Gallery) | A validation-status **filter** in the Gallery — *not* a validation of a label. |
| `Visit_SharedLabel=<labelId>` | Server-logged (not via a `Tracker.js`) in `ShareController.label` when the public `/label/:id` share page is loaded; the suffix is the shared label id. When the visit came from a story-anchored share (`?storyId=`, #4722) **and** that story resolved to a visible story on the label, the event continues `_storyId=<id>` — so a bare event on a story-share URL means the link outlived its story. |
| `Visit_Welcome` | Server-logged in `UserController.welcome` when the post-registration `/welcome` page renders (#4375); every fresh registration lands there, so its volume tracks completed sign-ups. |
| `Visit_MobileSignIn` / `Visit_MobileSignUp` | **Retired in #4884** (the forked `/signInMobile`·`/signUpMobile` pages were removed; those URLs now 301 to the responsive pages). Historical data only — from the removal onward, mobile auth-page visits log as `Visit_SignIn` / `Visit_SignUp`, so combine the names across that boundary when analyzing auth-page traffic by era. |
| `Visit_About` | Server-logged in `ApplicationController.about` when the native `/about` page renders (#4237). Older data has client-logged `Visit_About` events from the footer link out to the external Makeability Lab about page; query both eras with the same name. |
| `Click_module=AboutPage_target=<target>` | Clicks on the About page (#4631), client-logged from `aboutPage.js` following the footer convention. Static targets: `hero_explore` / `hero_data` (hero CTAs), `step_explore` / `step_validate` / `step_data` (the how-it-works step buttons), `cta_explore` / `cta_city` (closing-band CTAs; `cta_city` is the outbound accessiblecommunities.org link). Delegated targets for links inside the Makeability-Lab-hydrated sections: `team_member`, `publication`, `grant`. The in-page section nav logs `toc_<section>` (`toc_how`, `toc_where`, `toc_team`, …), the section id minus its `about-` prefix. |
| `ServiceHours_Set=<bool>` | Server-logged in `UserController.setServiceHours` when a user opts in to (`true`) or out of (`false`) official community-service-hour recognition from the `/welcome` callout or the `/serviceHoursInstructions` toggle (#4375). |
| `Share_Click` / `Share_Native` / `Share_CopyLink` / `Share_Platform=<Twitter\|Bluesky\|Facebook\|LinkedIn\|Email>` | Emitted by the frontend share widget: opening the share UI, invoking the native OS share sheet (touch-primary devices only), copying the permalink, and sharing to a named platform (the `Share_Platform` suffix is the target). |
| `Click_module=SharedLabel_target=<FullMap\|Explore\|Validate\|NearbyLabel>` | Outbound/interactive clicks on the public spotlight page (`SharedLabel.js`): `FullMap` = the "explore the full map" caption link into the LabelMap, `Explore`/`Validate` = the call-to-action buttons into those tools, `NearbyLabel_labelId=<id>` = clicking a nearby-labels map marker (the suffix is that neighbor's label id). |
| `Click_module=LabelDetail_action=<PanoInfoButton\|PanoInfoCopyToClipboard\|PanoInfoViewInPano\|ViewOnLabelMap\|ExploreHere>_labelId=<id>` / `Click_module=LabelPopup_action=<NextLabel\|PrevLabel>_labelId=<id>` | The shared Label Detail Card (#4572) on its `webpage_activity`-logged hosts (LabelMap, Gallery, dashboards, admin, share page): opening the Details popover, its copy-to-clipboard and view-in-provider actions, the "View on Label Map" hop, the "Explore the sidewalks here" hop into a free-exploration Explore session seeded at the label's pano + POV (#4637), and the popup's prev/next nearby-label arrows (`labelId` is the shown label; the arrows log the label paged *from*). On Explore/Validate the same popover logs through those tools' trackers as `PanoInfo*_Click` instead. |
| `Click_module=LabelDetail_action=ClearVote_result=<Agree\|Disagree\|Unsure>_labelId=<id>` | The user cleared their validation of a label by re-clicking the vote they'd already cast on the label detail card (#4653); `result` is the vote that was cleared. **Casting** a vote isn't logged here — it lands in `label_validation` with a `source` naming the surface — but clearing one *deletes* that row, so this event is the only record it happened. The Gallery's small cards vote through their own tracker instead, where the same action reads `Validate_MenuClickClear<Result>` / `Validate_ThumbsMenuClickClear<Result>` (or `…KeyboardShortcutClear<Result>`). |
| `Click_module=StorySectionExpand_labelId=<id>` / `Click_module=StoryComposerOpen_labelId=<id>` / `Click_module=StoryEditOpen_storyId=<id>` / `Click_module=StorySignInCta_labelId=<id>` / `Click_module=StoryPhotoEnlarge_storyMediaId=<id>` / `Click_module=StoryDashboardLink_labelId=<id>` | Lived-experience stories on the label-detail card (#4054): expanding the stories disclosure, opening the composer dialog (blank or prefilled for an in-place edit), clicking the composer's sign-in CTA (stashes the in-progress draft, then bounces to `/signIn`), enlarging a story photo into the lightbox, and following the own-story "See all your stories" link to the dashboard. Client-logged from `StorySection.js`/`StoryComposer.js`. `StoryEditOpen` also fires from the dashboard's "Your stories" list (#4656), which drives the same composer from `StoriesSection.js`. |
| `Click_module=StorySubmit_labelId=<id>_hasPhoto=<bool>` vs `Click_module=StorySubmitClient_…` | Story submission is logged twice: server-side in `StoryController.submitStory` on every attempt (`StorySubmit`, before validation — includes rejected attempts) and client-side only on success (`StorySubmitClient`). The gap between the two counts rejected/failed submissions. |
| `Click_module=StoryUpdate_storyId=<id>_hasPhoto=<bool>` vs `Click_module=StoryUpdateClient_storyId=<id>` | An in-place story edit, mirroring the submit pair: server-logged on every PUT attempt (including rejections and a non-owner's 404), client-logged on success. `hasPhoto` marks whether the edit uploaded a replacement photo. |
| `Click_module=StoryDelete_storyId=<id>` vs `Click_module=StoryDeleteClient_…` | A story retraction: server-logged on every DELETE attempt (including a non-owner's 404), client-logged when the confirm dialog is accepted on the card or dashboard. |
| `Click_module=AdminStoryVisibility_storyId=<id>_hidden=<bool>` / `Click_module=AdminStoryDelete_storyId=<id>` | Server-logged admin moderation actions on `/admin/stories`: hide/unhide (reversible quarantine) and permanent delete. |
| `TutorialIntro_Start` / `TutorialIntro_Next` / `TutorialIntro_StartMission` / `TutorialIntro_Skip` | The pre-tutorial intro walkthrough shown before the Explore onboarding (`explore/src/onboarding/TutorialIntro.js`): shown, advanced a step (`step` note = new index), finished into the tutorial, or skipped. `TutorialIntro_Skip` precedes the same `Onboarding_Skip` the onboarding itself emits, so a skip logs both. |
| `TutorialIntro_PauseAnimation` / `TutorialIntro_PlayAnimation` / `Onboarding_PauseAnimation` / `Onboarding_PlayAnimation` | The pause control on the looping tutorial illustration clips — the intro walkthrough's per-step clip and the tutorial-complete celebration clip. Only a click on the control logs; a visitor whose `prefers-reduced-motion` setting starts the clips paused logs nothing. |
| `MinimapOverview_End` / `Click_MinimapFitRoute` | The minimap's fitted whole-route overview (#4639): ended (the `trigger` note says how — `pano-changed`, `zoom`, `fit-button`, or `route-inset`), and the manual toggle from the ⛶ button or the route-overview inset (`mode` note = the resulting state, `trigger` note = which control). |
| `Click_MinimapRouteOverview` | Click/tap on the whole-route overview inset shown on designated (RouteBuilder) routes (#4639); precedes the `Click_MinimapFitRoute` it triggers (`trigger=route-inset`), fitting the minimap to the whole route. |
| `MinimapCoach_Shown` / `Click_MinimapCoach_GotIt` / `MinimapCoach_AutoDismissed` | The first-run "turn 360°" coach mark on the minimap (#4639; replaced the permanent banner). Shown at most once per user; dismissed by the button or automatically on the first completed 360°. |
| `Minimap360Celebration_Shown` / `Click_MinimapLegend_Open` / `Click_MinimapLegend_Close` | The one-time first-full-360° ring celebration, and the collapsible minimap legend opening/closing (`MinimapLegend_EscapeClose` when closed via Esc). |
| `Click_MinimapLabelMarker` | Click on a label's minimap marker to return to the pano where it was placed and re-center it, so the user can review or re-mark it (#2561; `labelId`/`panoId` notes). Only fires for labels from the current mission — the return is always to an already-visited area. |
| `Click_MinimapBreadcrumb` | Click on a breadcrumb ring on the minimap (a visited pano) to hop back to that pano (#2561/#4639; `panoId` note). Breadcrumbs exist only for already-visited panos, so the return is always to a previously-seen location. |
| `Click_module=ExploreSidewalksHere_lat=<lat>_lng=<lng>` | LabelMap: the "Explore the sidewalks here" popup button after an address search (#4451) — an outbound click into the free-exploration Explore session at those coordinates. |
| `Visit_Audit_ExploreAddress_Lat=<lat>_Lng=<lng>` | Server-logged in `ExploreController.explore` when `/explore?lat&lng` opens a free-exploration (exploreAddress) session at a searched address (#4451). |
| `ExploreAddress_SessionStart` | Explore (`audit_task_interaction`): the free-exploration UI finished loading. Sessions under the `exploreAddress` mission type label normally but never complete tasks/missions, so don't mix them into street-completion or mission-funnel analyses. |
| `RouteBuilder_Click=OpenSaveModal` / `CloseSaveModal` / `SignInToSave` / `ContinueAsGuest` | The RouteBuilder save flow (#3343): opening the name-your-route modal, dismissing it without saving (Cancel, the X, or Escape), choosing to sign in before saving (the route is stashed and restored after the sign-in reload), or saving as a guest. `SaveSuccess_RouteId=<id>` / `SaveError` mark the POST's outcome, as before the redesign. |
| `RouteBuilder_Click=SavedRoute_Edit_RouteId=<id>` / `SavedRoute_Explore_RouteId=<id>` / `SavedRoute_Copy_RouteId=<id>` | Actions on a card in the intro panel's "Your saved routes" section: loading the route into the editor (clicking the card body), opening it in Explore, or copying its `/r/<slug>` share link. Signed-in users see their account's routes there; guests see the device-local list. |
| `RouteBuilder_Click=UpdateRoute_RouteId=<id>` / `UpdateSuccess_RouteId=<id>` / `UpdateError` | The Update Route button while editing a loaded saved route: the PUT writing the edited street list back to the same route, and its outcome. |
| `RouteBuilder_Click=NewRoute` | The Create-a-new-route button in the planner card: clears the current route or editing session (confirming first if unsaved work would be lost), returns to the intro state, and resets the camera to the city view. |
| `RouteBuilder_Click=ExitEditSession` | Closing an editing session that has no unsaved edits (re-clicking the active card, or the trash can) — the saved route is untouched and the builder returns to the intro state. |
| `RouteBuilder_AddWaypoint=Success_Count=<n>_Source=<MapClick\|AddressStart\|AddressEnd>` / `NoPath_Source=…` / `DifferentRegion_Source=…` | Point-to-point routing (#4579): a map click (or a typed Start/End address) added waypoint `n`, extending the route from the previous point along an A* walking path. `NoPath` / `DifferentRegion` mark a click that couldn't be added because it was unreachable or fell outside the route's neighborhood. |
| `RouteBuilder_Click=SetStartAddress` / `SetEndAddress` | A Start or End address was chosen from the search field, planting a waypoint there. |
| `RouteBuilder_Click=RouteMenu_Open` / `RouteBuilder_Hover=RouteMenu_Open` / `RouteBuilder_Click=ReverseRoute_Popover` / `DeleteRoute_Popover` | The on-route action menu: clicking the drawn route opens it immediately, and resting the pointer on it for ~500 ms opens it too (the Hover variant). The Reverse/Delete events are its buttons (Delete opens the discard-confirm dialog, so a completed delete also emits `ConfirmCancelRoute`). |
| `RouteBuilder_Click=SelectRegion_RegionId=<id>` | The first step of the staged flow: clicking the neighborhood to build a route in (also fires when the selection is moved to a different region before any point is placed). Address-seeded starts select the region implicitly and don't emit this. |
| `RouteBuilder_Click=TogglePois_Visible=<bool>` | The legend's points-of-interest checkbox, showing/hiding the basemap's POI labels (schools, parks, ...). |
| `RouteBuilder_Click=PreviewRoute` | The Preview button in the planner card: the explorer icon walks the route from start to end as an animated preview. |
| `RouteBuilder_Click=Undo` / `RouteBuilder_KeyboardShortcut=Undo` | The same undo action (#4576) via the button vs Ctrl/Cmd+Z — don't double-count. |
| `RouteBuilder_Click=CancelRoute` / `ResumeRoute` / `ConfirmCancelRoute` | The clear-route flow: opening the discard-confirm dialog, backing out of it, or confirming the discard. While a saved route is being edited, the dialog is about discarding unsaved edits — the saved route itself is never deleted from here. |
| `Click_module=RouteList_<View\|Explore\|LabelMap\|Copy\|Rename\|Delete>_RouteId=<id>` | Actions on a saved route in the dashboard's "My Routes" section (`MyRoutes.js`); `View` is the thumbnail click that opens the route in the RouteBuilder editor. |
| `Visit_Stories` / `Visit_Routes` | Page views of the public community listing pages, `/stories` and `/routes` (#4688). |
| `Click_module=<StoryListPage\|RouteListPage>_Search` / `..._Sort=<option>` | The listing pages' toolbar: the first use of the search box per page view (never the typed query), and each sort change. |
| `Click_module=StoryListPage_ViewLabel_LabelId=<id>` | Opening a story's label from a `/stories` card (inline popup, or navigation when the popup failed to initialize). |
| `Click_module=StoryListPage_Card_LabelId=<id>` | The same, reached by clicking the card itself rather than its "View label" button. Logged separately so the two entry points stay comparable. |
| `Click_module=StoryListPage_Location_LabelId=<id>` | Following a story card's address/neighborhood line to the label on the LabelMap. |
| `Click_module=StoryCardShare_storyId=<id>` | Opening a `/stories` card's share chip (#4722) — surface + story attribution, mirroring `LandingValidationGridShare`. Fires alongside `ShareWidget`'s generic `Share_*` events; only `Share_CopyLink` / `Share_Platform=<…>` / `Share_Native` mean a link actually left the page. The shared URL is the story-anchored label permalink (`/label/<labelId>?storyId=<id>`). |
| `Click_module=RouteListPage_<Explore\|LabelMap\|Copy>_RouteId=<id>` | Actions on a route card on `/routes` (`RouteListPage.js`). |

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
