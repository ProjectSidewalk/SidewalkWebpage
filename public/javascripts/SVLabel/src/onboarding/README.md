# Explore onboarding tutorial

This directory implements the **interactive onboarding tutorial** that new users go through on the Explore/Audit page
before labeling for real. It walks them through a scripted Google Street View pano, prompting them to pan, zoom, and
place each label type. This README orients you for editing that flow; the behavior lives in the files here, so keep
this doc in sync when you change them.

## Files

| File | Responsibility |
|------|----------------|
| `OnboardingStates.js` | **The script.** An ordered list of tutorial *states* (steps) and how each advances to the next. This is what you edit most. |
| `Onboarding.js` | **The engine.** Reads the current state, renders its message/annotations, wires up the listeners that detect the user's action, and transitions to the next state. |
| `HandAnimation.js` | The animated hand hint shown during some steps. |
| `InitialMissionInstruction.js` | The instructional messaging shown for the first real mission, just after onboarding. |

## How a state is shaped (`OnboardingStates.js`)

Each entry in the states array describes one step. The common fields:

- **`id`** — the state's unique name (e.g. `"select-label-type-1"`); `transition` functions return these to move
  between states.
- **`progression`** — `true` if this state counts toward the tutorial **progress bar**. (This replaced the older
  manual `completedRate`/`numStates` bookkeeping — you no longer hand-maintain counts; just set `progression`
  correctly on each state and the bar is derived from it.)
- **`properties`** — drives the step's behavior. Watch especially:
  - `action` — what the user must do (e.g. `"SelectLabelType"`, `"WalkTowards"`); `Onboarding.js` branches on this.
  - `labelType` — the label type involved, when relevant.
  - `minHeading` / `maxHeading` — the allowed pano heading range for this step (from `headingRanges`).
- **`message`** — the text shown in the tutorial speech bubble. Use `i18next.t('tutorial.<key>')` — **tutorial text is
  internationalized**, so add the corresponding key to the `tutorial` namespace for every supported language rather
  than hardcoding a string (see [`CONTRIBUTING.md`](../../../../../CONTRIBUTING.md) → Internationalization).
- **`panoId`** — the GSV pano used for the tutorial. It's the same shared value (`"tutorial"`) for all states.
- **`annotations`** — optional visual overlays (arrows, etc.) with pixel `x`/`y` positions on the pano. Easiest to
  copy and tweak from a nearby state.
- **`transition`** — a function called when the state's action is completed. It returns the **`id` of the next
  state** (it can branch on what the user did). Some terminal states use special keys like `end-onboarding`
  instead.

## How the engine runs them (`Onboarding.js`)

The control flow centers on `_visit(state)`: it renders the state, then (based on `properties.action`) attaches the
listeners that wait for the user to do the right thing. When they do, the state's `transition` runs and its return
value is passed back into `_visit(getState(nextState))` to advance.

To add a step of an **existing** action type, add a new state object and point the previous state's `transition` at
it. To add a **new** action type, you'll also add a handler in `Onboarding.js` that knows how to set up and detect
that interaction.

## Tips

- Edit `src/` files only — Grunt rebuilds the `build/` bundle (see [`CONTRIBUTING.md`](../../../../../CONTRIBUTING.md)).
- The tutorial can't be exercised by automated GSV testing; step through it manually in the browser after changes.
- For worked examples of tutorial-flow changes, see PRs
  [#1493](https://github.com/ProjectSidewalk/SidewalkWebpage/pull/1493) and
  [#1485](https://github.com/ProjectSidewalk/SidewalkWebpage/pull/1485).
