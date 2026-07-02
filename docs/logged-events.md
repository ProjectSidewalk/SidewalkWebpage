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
| **Explore / Audit** (`SVLabel`) | `public/javascripts/SVLabel/src/data/Tracker.js` | `audit_task_interaction` | `app/models/audit/AuditTaskInteractionTable.scala` |
| **Validate** (`SVValidate`, incl. mobile) | `public/javascripts/SVValidate/src/Tracker.js` | `validation_task_interaction` | `app/models/validation/ValidationTaskInteractionTable.scala` |
| **Gallery** (`Gallery`) | `public/javascripts/Gallery/src/data/Tracker.js` | `gallery_task_interaction` | `app/models/gallery/GalleryTaskInteractionTable.scala` |

The core call is **`tracker.push(action, note)`** (see `Tracker.push` in each Tracker file):

- `action` — the event name (a string; see [naming](#event-naming)).
- `note` — an optional object of extra fields (e.g. `{labelType}`, `{cursorX, cursorY}`, `{keyCode}`) stored with the
  event.

Each pushed event is buffered with a timestamp and context (pano, task, lat/lng, …) and flushed to the backend
periodically — on mission complete or after enough interactions accumulate — which is itself recorded as a
`RefreshTracker` event.

## Event naming

Most events are fixed, transparently-named strings (`ContextMenu_Open`, `Onboarding_Start`, `Click_ZoomIn`). The ones
worth knowing about are the **families assembled at runtime**, which you won't find as full string literals:

- **`LowLevelEvent_<domType>`** — raw DOM events. `Tracker.trackWindowEvents()` (in
  `SVLabel/src/data/Tracker.js`) binds `mousedown`, `mouseup`, `mouseover`, `mouseout`, `mousemove`, `click`,
  `contextmenu`, `dblclick`, `keydown`, `keyup` and pushes `"LowLevelEvent_" + e.type`, with `cursorX`/`cursorY` or
  `keyCode` in the note.
- **`ModeSwitch_<LabelType>`**, **`Click_ModeSwitch_<LabelType>`**, **`KeyboardShortcut_ModeSwitch_<LabelType>`** —
  labeling-mode changes; suffix is the label type (`CurbRamp`, `NoSidewalk`, …) or `Walk`. The prefix encodes *how*
  the switch happened: programmatic vs. a mouse click (emitted in `SVLabel/src/menu/RibbonMenu.js`) vs. a keyboard
  shortcut (`SVLabel/src/keyboard/Keyboard.js`).
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
| `ValidationOptionApply` / `ValidationOptionUnapply` (Gallery) | A validation-status **filter** in the Gallery — *not* a validation of a label. |

## Finding the current list

The reference above is intentionally partial. To get the **authoritative, current** set for a tool, search its
`src/` for `push(` and read the surrounding code (remember the [runtime families](#event-naming) won't appear as full
literals):

```bash
# Literal event names emitted by the Explore tool (swap in SVValidate/src or Gallery/src for the others):
grep -rhoE "push\(\s*['\"][A-Za-z0-9_]+" public/javascripts/SVLabel/src --include=*.js | sort -u
```

Then read each tool's `Tracker.js` for the generated families (start with `trackWindowEvents()` in
`SVLabel/src/data/Tracker.js`), and `SVLabel/src/menu/RibbonMenu.js` + `SVLabel/src/keyboard/Keyboard.js` for the
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
