# Code review: PR #4595 — RouteBuilder redesign (#4579)

Max-effort multi-agent review of PR #4595 ("RouteBuilder redesign: point-to-point auto-routing, saved-route editing,
and share links"), branch `4579-routebuilder-auto-routing` at commit `0efbe70a4`, diffed against `develop`
(merge-base `1406a6c7c`). Review date: 2026-07-22.

**Method.** 11 independent finder agents (5 correctness angles, a deep-JS behavioral pass, and reuse /
simplification / efficiency / altitude / conventions angles) scanned the 8,917-line first-party diff (95 files;
the ~34k-line accidental `public/javascripts/` build artifacts were excluded from scanning and reported as a
finding). Every correctness candidate then got an independent verification pass — 16 verifier agents plus direct
empirical reproduction (live HTTP repro, running the spec suite, Node harness tests against `RouteGraph.js`, and
dev-DB queries) — followed by a fresh gap-sweep agent over under-covered areas, whose findings were verified
directly. **Result: 23 confirmed correctness findings (none refuted) and 28 cleanup findings.**

Raw materials (finder candidate lists and the verification log) are in [`review-4595/`](review-4595/).

---

## Section 1 — Confirmed correctness findings (ranked by severity)

### 1. Saved-route editing 500s on any non-append street edit (transient UNIQUE collision)

- **File:** `app/service/RouteService.scala:222` (`reconcileStreetsAction`)
- **Verdict:** CONFIRMED — reproduced live over HTTP and by the PR's own spec test; 5 finder angles converged.
- **Summary:** `reconcileStreetsAction` updates/inserts `route_street.position` row by row against the new
  **non-deferrable** `UNIQUE (route_id, position)` constraint (344.sql), and deletes removed rows only *after* the
  updates. Any street-list edit that isn't a pure tail append — reverse, reorder, mid-route insert, non-tail
  removal, prepend — transiently duplicates a `(route_id, position)` pair mid-transaction.
- **Failure scenario:** Reproduced: save route `[street 1970]` as route 9, then
  `PUT /userapi/routes/9` with `[28, 1970-reversed]` → PSQLException 23505
  `duplicate key value violates unique constraint "route_street_route_id_position_key",
  Key (route_id, position)=(9, 0) already exists`. `withSlugRetry` retries the identical transaction and fails
  again → 500; the user sees the generic save-error toast on every attempt and the edit is lost. In the UI this is
  simply: load a saved route → click Reverse → click "Update route". The PR's own
  `RouteBuilderControllerSpec` "replace the street list in place" test fails with exactly this error. This breaks
  the PR's headline update-in-place feature.
- **Fix:** Delete removed rows first, then write positions in two passes (e.g. shift surviving rows to
  `-(position + 1)` and then set final values), or declare the constraint `DEFERRABLE` in 344.sql and
  `SET CONSTRAINTS ... DEFERRED` inside the transaction.

### 2. Branch test suite does not compile

- **File:** `test/service/ExploreAddressServiceSpec.scala:544`
- **Verdict:** CONFIRMED — reproduced in the web container by three independent agents.
- **Summary:** The PR adds a 17th field (`userRouteId`) to the `Mission` case class but does not update this
  pre-existing `Mission(...)` constructor call.
- **Failure scenario:** `sbt test` (and CI's DB-backed test job) fails at `Test/compileIncremental`:
  `not enough arguments for method apply ... Unspecified value parameter userRouteId`. No test in the suite —
  including the new `RouteBuilderControllerSpec` — can execute at this PR's HEAD.
- **Fix:** Append `None` (i.e. `userRouteId = None`) to the `Mission(...)` call at line 544.

### 3. ~34,000 lines of stale build artifacts committed under the obsolete asset layout

- **File:** `public/javascripts/*/build/*` (8 files: `SVLabel.js/.css`, `SVValidate.js/.css`, `Gallery.js/.css`,
  `Admin.js`, `Progress.js`, `help.js`), added by commit `2e14abdb6`
- **Verdict:** CONFIRMED — files absent on `develop`; referenced by nothing (no Twirl view, no Gruntfile glob).
- **Summary:** Build outputs at the pre-#2292 `public/javascripts/` paths were accidentally committed. They
  slipped past `.gitignore` because it only covers `public/js/*/build/*`.
- **Failure scenario:** 34k dead generated lines bloat the PR and permanently pollute repo history; a later
  `develop` commit ("Getting rid of the built file") had already deliberately removed such artifacts.
- **Fix:** `git rm -r public/javascripts/` and add `public/javascripts/` (or the old build globs) to `.gitignore`.

### 4. Out-and-back routes can never be completed (audit link resolves to the wrong route_street row)

- **File:** `app/models/route/AuditTaskUserRouteTable.scala:75` (`insertIfNew`)
- **Verdict:** CONFIRMED — verifier traced the full serve/submit/completeness cycle.
- **Summary:** `insertIfNew` resolves the `route_street` row for an audit task by joining on `street_edge_id`
  with an unordered `.head` — no disambiguation by position or `route_street_id`. For a route containing the same
  street twice (the out-and-back case this PR explicitly enables by dropping `UNIQUE (route_id, street_edge_id)`),
  every audit of that street links to the same first row; nothing prevents two tasks linking the same row (only
  `audit_task_id` is unique on `audit_task_user_route`), and the task submission carries no `routeStreetId` (the
  `NewTask` field is transient and never persisted).
- **Failure scenario:** Route `[..., A (reverse=false), A (reverse=true)]`: the first audit of A links row 1;
  `getRouteTask` later finds row 2 unlinked and re-serves street A as a fresh task; on submit, `insertIfNew` again
  picks row 1, so row 2 stays unlinked forever. `updateCompleteness` (which requires every `route_street` row
  matched) never marks the `user_route` complete and the server keeps sending the user back to street A on every
  session. Client-side, `TaskContainer.nextTask` filters by `streetEdgeId`, compounding the problem by silently
  skipping the return-leg task.
- **Fix:** Persist/pass the *served* `routeStreetId` through the task submission (add it to
  `AuditTaskSubmission`, or store it on `audit_task`) instead of re-deriving it from `street_edge_id`. A minimal
  mitigation is to exclude already-linked `route_street` rows and order by `position` in the `insertIfNew` query.

### 5. Imagery-exhaustion gate is inert — tasks always end "complete" regardless of position

- **File:** `public/js/explore/src/navigation/NavigationService.js:137` (`#handleImageryNotFound`)
- **Verdict:** CONFIRMED — verified directly against `Task.isAtEnd` and `svl.CLOSE_TO_ROUTE_THRESHOLD`.
- **Summary:** The near-end gate
  `if (currentTask.isAtEnd(svl.panoViewer.getPosition(), svl.CLOSE_TO_ROUTE_THRESHOLD) < 0.5)` is doubly broken:
  `Task.isAtEnd` returns a **boolean** (`d < threshold`), which is then compared `< 0.5`; and
  `CLOSE_TO_ROUTE_THRESHOLD = 0.05` is kilometers (used with `turf.pointToLineDistance` elsewhere) while
  `isAtEnd` compares a meters-based haversine — so `isAtEnd` is "within 5 cm" ≈ always `false`, and
  `false < 0.5` is always `true`. The near-end branch always fires; the `reportNoImagery` + skip-to-new-street
  branch is unreachable. The bug predates the PR, but this PR's new final-street deferral (lines 316–328) routes
  route completion through this path ("Defer to the imagery-exhaustion path"), making the dead gate load-bearing.
- **Failure scenario:** GSV imagery ends 300 m short on a route street with the user at 40% of it:
  `#endTheCurrentTask` runs unconditionally, the task is recorded as audited to its end, and on a route's final
  street the "Last stop! Take a full look around" 360°-gated completion fires at 40%. Mid-route streets with
  imagery gaps are silently ended as complete instead of being flagged no-imagery and skipped.
- **Fix:** `if (currentTask.isAtEnd(svl.panoViewer.getPosition(), 50))` — use the boolean directly with a
  meters threshold (and consider finding #40's deeper fix in `Task.isAtEnd` while there).

### 6. A route saved with zero streets 500s Explore for anyone opening its link

- **File:** `app/controllers/RouteBuilderController.scala:49` (`saveRoute`); crash site
  `app/service/ExploreService.scala:250`
- **Verdict:** CONFIRMED — full chain verified statically (every link unconditional).
- **Summary:** `saveRoute` validates name/description but never rejects an empty `streets` array (`updateRoute`
  does, at lines 107–108; the JSON `Reads` has no `minLength`). A zero-street route then crashes Explore's new
  route-scoped mission path: `getRouteDistance` sums to 0, `MissionService` returns `DBIO.successful(None)`
  (lines 218–223), and `ExploreService.scala:250`'s `.map(_.get)` throws `NoSuchElementException`.
- **Failure scenario:** `POST /saveRoute` with `{"region_id": R, "streets": [], "name": "x"}` → 200 with a
  route_id and shareable slug. Any post-onboarding user opening `/explore?routeId=<id>` (or `/r/<slug>`) gets a
  500 error page. The route is also invisible in `/userapi/routes` and the dashboard (inner join on
  `route_street` in `getRoutesForUser`), so its owner can't see or delete it through the UI.
- **Fix:** Mirror `updateRoute`'s non-empty-streets 400 in `saveRoute` (or add `minLength(1)` to the `streets`
  `Reads`); optionally harden `ExploreService:250` against `None`.

### 7. Streets shorter than 10 m are unroutable — loading a saved route silently drops them, and Update persists the loss

- **File:** `public/js/route-builder/src/RouteGraph.js:33` (edge construction), `:164` (`route()`),
  `public/js/route-builder/src/RouteBuilder.js:862`, `:1325-1335`
- **Verdict:** CONFIRMED — code + dev-DB evidence.
- **Summary:** Streets whose endpoints merge into one graph node (separation < `NODE_TOLERANCE_M` = 10 m) are
  skipped at edge construction (`if (keyA === keyB) return;`) and `route()` returns `no-path` for same-node
  from/to. Loading a saved route containing such a street puts both leg waypoints on the same node; `#recompute`
  silently skips the failed leg, only the generic "route-adjusted" toast shows, the saved baseline is reset to the
  reduced street list, and "Update route" PUTs the route back without the street.
- **Failure scenario:** 2,246 of 23,995 open Seattle streets have endpoint separation under 10 m, and two routes
  in the seeded dev dump (route 12: four streets at 3.5–4.7 m; route 48: one street at 6.4 m) already contain
  such streets. Loading and updating either silently deletes those streets — and their linked
  `audit_task_user_route` progress — from the saved route. The new builder can't *create* such routes (the
  edgeless street is unreachable by A*), so this bites legacy/loaded routes.
- **Fix:** Represent single-node streets as self-loop edges (or special-case them during load so stored streets
  are trusted verbatim rather than re-routed); see also finding #10, which shares the "reconstruct by re-routing"
  root cause.

### 8. Evolution 344 Downs fail once any out-and-back route exists

- **File:** `conf/evolutions/default/344.sql:72` (`!Downs`)
- **Verdict:** CONFIRMED — with one correction to the original candidate (transaction rolls back fully).
- **Summary:** The Downs re-add `UNIQUE (route_id, street_edge_id)` on `route_street` without deduplicating rows
  first. The Ups exist precisely to allow duplicate streets per route (out-and-back), and `saveRoute` inserts
  `route.streets` verbatim — so real data violates the constraint the Downs try to restore.
- **Failure scenario:** With `autoApplyDowns=true` (set in `application.conf`), switching a dev DB back to
  `develop` after saving one out-and-back route makes the Down's `ADD CONSTRAINT` raise a unique violation.
  Because `autocommit=false`, the whole Down script rolls back (schema not half-reverted), but Play records the
  failure and **blocks app startup** until the duplicate rows are manually deleted and the evolution resolved.
- **Fix:** In the Downs, dedup first — keep `MIN(route_street_id)` per `(route_id, street_edge_id)`, deleting
  dependent `audit_task_user_route` rows — before `ADD CONSTRAINT`.

### 9. Wrong walking direction persisted for streets whose endpoints are 10–15 m apart

- **File:** `public/js/route-builder/src/RouteGraph.js:218` (`#reconstructPath`)
- **Verdict:** CONFIRMED — empirically, via a Node harness with synthetic GeoJSON.
- **Summary:** `#reconstructPath` decides traversal direction by testing whether the entry node is within 15 m
  (`NODE_TOLERANCE_M * 1.5`) of `coords[0]` — an absolute test instead of comparing distances to both endpoints.
  Sub-10 m streets never become edges (see #7), so the live failure band is endpoint separation in **[10 m, 15 m)**
  — including long curved streets (hooks, crescents) whose endpoints happen to lie that close.
- **Failure scenario:** Reproduced: a street with 13.34 m endpoint separation entered at its *last* coordinate
  computed `flip=false` (correct value: `true`); a 17.8 m control in identical topology was handled correctly.
  Consequence: direction arrows render backwards, the route polyline is discontinuous at that street, and the
  wrong `reverse` flag is saved to `route_street`, so Explore starts the user at the wrong end of that street.
- **Fix:** Compare the entry node's distance to `coords[0]` vs `coords[coords.length - 1]` and pick the nearer.

### 10. Loading a saved route can silently substitute a parallel street — and the UI reads "Saved"

- **File:** `public/js/route-builder/src/RouteBuilder.js:1330` (adjustment detection), `:1271`
  (`#waypointsFromStreets`), `:1335` (baseline snapshot)
- **Verdict:** CONFIRMED.
- **Summary:** Loading reconstructs the route by A*-routing between per-street *boundary* waypoints
  (`#waypointsFromStreets` emits only endpoint coordinates — no mid-street point), so two parallel edges sharing
  both endpoint nodes are indistinguishable and A* deterministically picks the lower-weight one. The
  "route-adjusted" detection compares only street **counts** (`features.length !== data.streets.length`), which a
  1-for-1 substitution passes, and `#savedBaseline` is snapshotted *after* reconstruction, so the substituted
  route compares clean.
- **Failure scenario:** A saved route traverses the longer of two streets connecting the same two intersections
  (a crescent vs the straight block). On load, the shorter street is drawn instead; no toast fires; the save
  button shows the disabled "Saved" state; the loaded view misrepresents the stored route, and any later
  edit + Update (or the auto-saved draft) persists the substituted street.
- **Fix:** Seed reconstruction from the stored street ids instead of re-routing (fixes #7's load path too), or at
  minimum detect adjustment by comparing street-id sequences rather than counts and snapshot the baseline from
  the fetched payload.

### 11. Soft-deleting a route strands other users' in-progress walks in a wedged session

- **File:** `app/service/ExploreService.scala:250`/`:259`; root cause
  `app/models/route/UserRouteTable.scala:46` (`getInProgressRoute`)
- **Verdict:** CONFIRMED — key premises verified directly (`getInProgressRoute` filters only
  `!completed && !discarded`; `deleteRoute` is a soft delete flipping `route.deleted`).
- **Summary:** `getInProgressRoute` never checks `route.deleted`, so after an owner deletes a shared route,
  another user's dangling `user_route` still resumes. The session is then built inconsistently: the mission is
  route-scoped via `userRoute` (line 250) while the task branch keys off `routeOption` (line 259), which is `None`
  because `getRoute` filters deleted routes — so the task loads without `routeStreetId`/`routeStreetPosition`.
- **Failure scenario:** User B opens a shared route in Explore and leaves mid-route; the owner deletes the route;
  B later visits `/explore` (`resumeRoute` defaults true): a route-scoped mission is created (`getRouteDistance`
  still > 0 from surviving `route_street` rows) but the current task carries null route metadata, so
  `audit_task_user_route` progress is never linked and the route session can neither progress nor cleanly fall
  back to normal exploration — permanently wedged, with the mission panel showing an empty route name.
- **Fix:** Join `route` in `getInProgressRoute` and exclude deleted routes (or discard dangling `user_route`
  rows in `deleteRoute`).

### 12. Reloading a preview link silently discards unsaved edits

- **File:** `public/js/route-builder/src/RouteBuilder.js:1201` (`#maybeRestorePendingRoute`)
- **Verdict:** CONFIRMED.
- **Summary:** The `?preview=<id>` branch runs before the sessionStorage draft-restore branch, and the param is
  never stripped via `history.replaceState`, so it persists across F5. `#unsavedWorkConfirmed` no-ops on a fresh
  page (in-memory state is empty; the unsaved work exists only in the not-yet-read draft), and
  `#emptyRoute` → `#saveDraft` with 0 waypoints *deletes* the draft before the saved version is drawn.
- **Failure scenario:** Open `/routeBuilder?preview=42` from the dashboard (same-tab link, so sessionStorage
  survives), edit the route (each edit and pagehide write a draft with `editingRouteId: 42`), press F5: the
  preview branch refetches the saved version and the draft is destroyed — all unsaved edits lost with no confirm.
- **Fix:** On reload, prefer a matching draft (`draft.editingRouteId === previewParam`) over the preview fetch,
  or strip `?preview` with `history.replaceState` after the initial load.

### 13. Loading a route whose streets are all hidden silently wipes current work

- **File:** `public/js/route-builder/src/RouteBuilder.js:1323` (`#loadRouteForEditing` early return)
- **Verdict:** CONFIRMED — with a mechanism correction: the trigger is street *status*, not `filterLowQuality`.
- **Summary:** The street layer loads only status-`Open` streets (`StreetEdgeTable` filters
  `status === Open`), while the route-streets endpoint returns raw `route_street` rows with no status filter. If
  every street of a saved route has gone non-Open since it was saved (`make hide-streets-without-imagery`, or a
  region closed via reveal-or-hide-neighborhoods), `#drawStreetList` resolves zero ids and the bare
  `return` at :1323 fires **after** `#emptyRoute` has wiped the current route, overwritten the draft with empty
  state, and `#undoStack.clear()` killed undo — with no toast (the "route-adjusted" toast is below the return;
  the catch toast only covers fetch errors).
- **Failure scenario:** User has an in-progress route, clicks such a saved-route card, confirms the generic
  unsaved-work dialog expecting the saved route to load: current work irrecoverably discarded, nothing loads,
  zero feedback, editing/card state cleared. (The partial-drop case is handled with a toast; only all-gone falls
  through.)
- **Fix:** Resolve street ids *before* wiping, and show an error (without wiping) when nothing resolves.

### 14. Typing a Start address after building extends the route's END instead of moving the start

- **File:** `public/js/route-builder/src/RouteBuilder.js:228` (`onSetStart` wiring), `:818-827` (`#addWaypoint`)
- **Verdict:** CONFIRMED.
- **Summary:** `onSetStart: (lngLat) => this.#addWaypoint(lngLat, 'AddressStart')` — identical wiring to
  `onSetEnd`. `#addWaypoint` always routes from the current tail and appends; there is no start-vs-end
  distinction and no `#waypoints.length` guard. The Start search box deliberately stays visible and interactive
  in the "building" state (route-builder.css keeps the block outside the state selectors; `DirectionsPanel` never
  disables it).
- **Failure scenario:** Build A→B by clicking, then type address C into the Start field to move the start: the
  route becomes A→B→C with C as the finish flag while the field labels the typed point "Start" — the user's
  intent is inverted, contradicting `DirectionsPanel`'s own doc ("Start plants the route's first point"). The
  field label eventually self-corrects on the next reverse-geocode, but the wrong tail waypoint has already been
  appended.
- **Fix:** When waypoints exist, either rebuild the route from the new start (with feedback) or refuse with a
  message; alternatively disable the Start field while building.

### 15. Save modal double-submit creates duplicate routes

- **File:** `public/js/route-builder/src/SaveModal.js:139` (`#submit`); bindings at `:47`, `:51-53`
- **Verdict:** CONFIRMED.
- **Summary:** `#submit` has no in-flight guard and never disables the confirm button; the modal is hidden only
  in the success handler (after the response resolves); the name input's Enter keydown handler doesn't check
  `e.repeat`. Backend `RouteService.saveRoute` inserts unconditionally, and the slug-collision logic makes
  duplicates *succeed* as `<name>-2`, `<name>-3` (`withSlugRetry` even absorbs the same-slug race).
- **Failure scenario:** Double-click "Save route" (or hold Enter): multiple POSTs race, each creating a route;
  `onSaved` runs per response (so `editingRouteId` lands on whichever response resolves last), and the
  saved-routes list / dashboard / guest localStorage show duplicates the user never intended.
- **Fix:** Set an in-flight flag and disable the confirm button on first submit; check `e.repeat` on keydown.

### 16. Loading saved routes has no fetch guard — last response wins over last click

- **File:** `public/js/route-builder/src/RouteBuilder.js:1316-1337` (`#loadRouteForEditing`)
- **Verdict:** CONFIRMED.
- **Summary:** No AbortController, sequence counter, or busy flag. The only response-side check
  (`#status.streetsRendered`) is a one-time map-init flag, never reset, so every in-flight response passes it.
  Cards stay clickable during a load, and `#unsavedWorkConfirmed` returns true silently while the first fetch is
  in flight (nothing drawn yet), so nothing serializes two loads.
- **Failure scenario:** Slow network; click saved-route card A then card B: B resolves first (B drawn,
  `editingRouteId=B`), then A's stale response arrives, calls `#emptyRoute` (wiping B and the undo stack), draws
  A, sets `editingRouteId=A`, persists A via `#saveDraft`, and marks card A active — the user clicked B last but
  is silently editing A. The same race fires between the `?preview` deep-link load and a card click.
- **Fix:** A per-load sequence token (ignore responses whose token isn't current) or an AbortController that
  cancels the previous load.

### 17. Undo after Reverse deletes the wrong end of the route

- **File:** `public/js/route-builder/src/RouteBuilder.js:1124-1142` (`#reverseRoute`, `#undo`);
  `UndoStack.js:39-41`
- **Verdict:** CONFIRMED.
- **Summary:** `#reverseRoute` mutates `#waypoints` without pushing or clearing an UndoStack entry, so the
  stack's entries stop corresponding to reality. `#undo` blindly pops a stale `'waypoint'` entry and runs
  `#waypoints.pop()` — which after the reversal removes the *original start* (now the finish). The Undo button
  stays enabled (the stack still holds one entry per added point) and Ctrl/Cmd+Z is bound.
- **Failure scenario:** Build A→B→C, click "Reverse route direction" (now C→A), press Ctrl+Z expecting to undo
  the reverse: waypoint A is silently deleted, leaving C→B still reversed; each further undo keeps eating the
  wrong end.
- **Fix:** Push an invertible `'reverse'` action on reverse (and handle it in `#undo`), or clear the undo stack
  on reverse.

### 18. Off-viewport geocoded address bypasses the one-neighborhood check and snaps anywhere

- **File:** `public/js/route-builder/src/RouteBuilder.js:658-662` (`#regionIdAtPoint`), `:805-811` (guard)
- **Verdict:** CONFIRMED.
- **Summary:** `#regionIdAtPoint` uses `map.queryRenderedFeatures(map.project(lngLat))`, which only sees
  features rendered in the current viewport — there is no geometry fallback against `#neighborhoodData`. The
  different-region refusal requires `pointRegionId !== null`, so a null (off-screen) region skips it. The
  `DirectionsPanel` retrieve handler adds the waypoint *before* any camera move, and `snapToStreet` has **no
  maximum snap distance**.
- **Failure scenario:** With a route started in region R, type an address in a different neighborhood (outside
  the viewport) into the End field: `queryRenderedFeatures` returns `[]` → null region → no
  "one-neighborhood-warning"; `snapToStreet(lngLat, R)` snaps the faraway coordinate to the nearest street of the
  locked region, silently extending the route to an arbitrary boundary street the user never intended.
- **Fix:** Test region membership with `turf.booleanPointInPolygon` against `#neighborhoodData` instead of
  `queryRenderedFeatures`, and add a max snap distance to `snapToStreet`.

### 19. Guest saved-route cards are permanently stale after an update

- **File:** `public/js/route-builder/src/RouteBuilder.js:1364-1367` (PUT success path), `:1583-1595`
  (`recordGuestRoute` call site); `SavedRoutesPanel.js:76-77`
- **Verdict:** CONFIRMED — including that guests *can* update (anonymous identities own their routes;
  `PUT /userapi/routes/:id` is `SecuredAction` with ownership by userId; the code's own catch comment
  acknowledges guest sessions).
- **Summary:** `recordGuestRoute` (which writes name, region, `distanceMeters`, `encodedPolyline` to
  localStorage) is called only from the first-save path. The update success path only calls
  `#savedRoutes.refresh()`, which for guests merely re-reads localStorage.
- **Failure scenario:** A guest saves a 1 km route, reopens it, extends it to 3 km, clicks "Update route": the
  server route is 3 km, but the "Your saved routes" card shows 1 km and the old thumbnail shape on every future
  visit — the share link and Explore lead to a route that doesn't match its card. Signed-in users are unaffected
  (their refresh re-fetches from the server).
- **Fix:** Re-record the guest localStorage entry (distance, polyline) in the PUT success path.

### 20. "Explored by N · Completed by M" counts attempts, not people — while the tooltip promises people

- **File:** `app/models/route/RouteTable.scala:164-170` (`getUsageCounts`)
- **Verdict:** CONFIRMED.
- **Summary:** The aggregation uses `group.length` and a summed completed flag over `user_route` rows — no
  `countDistinct(userId)`. Completed rows are not reused by `getActiveRouteOrCreateNew` (it searches only
  `!completed && !discarded`), so each repeat walk by the same user inserts a new row. The UI copy explicitly
  promises people: `routebuilder.json:21` — "Explored: how many *people* have started exploring this route."
  (Discarded rows are correctly excluded; they don't inflate the count.)
- **Failure scenario:** One user completes a route, then opens the same link again: a second `user_route` row is
  created and the card reads "Explored by 2 · Completed by 1" (then "…by 2" if they finish again) though only one
  person ever walked it.
- **Fix:** Count `countDistinct(userId)` for started, and distinct users among completed rows for completed.

### 21. Reverse-geocode responses race — stale street names can reach the saved route name

- **File:** `public/js/route-builder/src/DirectionsPanel.js:203-228`
- **Verdict:** CONFIRMED (modest severity).
- **Summary:** The response handler writes the field label and `#endpointStreets[which]` unconditionally — no
  sequence counter or AbortController. `#lastGeocoded` is set at *dispatch* time, so the >15 m movement guard
  never blocks a newer request; only response ordering matters, and Mapbox latency jitter routinely reorders.
- **Failure scenario:** Two quick route-extending clicks (end moves >15 m each): the first response resolves
  after the second and overwrites the End field and `#endpointStreets.end` with the *previous* endpoint's street.
  If the user then opens the save modal, `#suggestedRouteName()` prefills a stale "X to Y" name, which is persisted
  server-side if accepted. Self-heals on the next qualifying move; typed labels are protected by other guards.
- **Fix:** Per-field request sequence token; ignore responses that aren't the latest.

### 22. Admin task playback lost its user-position marker (deleted icon still referenced)

- **File:** `public/css/admin-task.css:83`
- **Verdict:** CONFIRMED — file deleted in this PR; reference intact.
- **Summary:** The PR deletes `public/images/icons/routebuilder/start-point.png` but `.user-marker` still uses
  it as `background-image`.
- **Failure scenario:** `/admin/task/<id>` renders the playback position as an empty 27×27 box — the marker is
  invisible because the image 404s.
- **Fix:** Point `.user-marker` at a surviving asset (e.g. the new `flag-start.svg`) or keep the PNG.

### 23. "My Routes" shows the UTC save date, not the local one

- **File:** `app/views/userDashboard/dashboard.scala.html:60` (`routeDateLabel`)
- **Verdict:** CONFIRMED — formatter applies a locale but no timezone conversion; pgjdbc returns `TIMESTAMPTZ`
  as an `OffsetDateTime` at UTC offset.
- **Summary:** `dt.format(ofLocalizedDate(MEDIUM).withLocale(...))` formats the UTC calendar date.
- **Failure scenario:** A Seattle user saves a route at 6 PM PDT on July 21 (01:00 UTC July 22); the card
  immediately shows "Jul 22, 2026" — a date in the user's future. Every evening save is off by one day.
- **Fix:** Convert with `.atZoneSameInstant(cityZone)` (the city's timezone from config) before formatting.

---

## Section 2 — Cleanup findings (reuse / simplification / efficiency / altitude / conventions)

Deduplicated across the five cleanup finder angles; items marked *(verified)* were individually re-checked
against the working tree.

### Duplication / reuse

**C1. Mapbox thumbnail URL template duplicated across JS and Twirl** *(flagged independently by 4 angles)* —
`public/js/route-builder/src/RouteBuilder.js:1003-1007` (`#thumbnailUrl`) and
`app/views/userDashboard/dashboard.scala.html:66-70` (`routeThumbUrl`) hardcode the identical recipe (style id
`cloov4big002801rc0qw75w5g`, `path-4+3E8BD9-0.9`, `auto/400x200@2x?padding=30`). Any thumbnail change requires
synchronized edits in two languages or dashboard and RouteBuilder cards silently diverge; the path color
`3E8BD9` also re-declares the `--color-link-100` token (main.css:114). Per the CLAUDE.md backend-source-of-truth
rule, emit a ready `thumbnail_url` (or the recipe) from the backend — `RouteService.getRoutesForUser` already
computes `encoded_polyline` and has the Mapbox key — and consume it from both the Twirl template and
`SavedRoutesPanel`.

**C2. `polylineEncoder.js` duplicates `PolylineEncoder.scala`** *(2 angles)* —
`public/js/route-builder/src/polylineEncoder.js` reimplements Google polyline encode + decimation (same magic
`maxPoints=60`, `RouteService.scala:138` vs `RouteBuilder.js:1594`) solely for the guest branch of
`#handleRouteSaved`. Two bit-compatible implementations in two languages must stay in sync; drift silently
produces different guest vs account thumbnails. Fix: have the `POST /saveRoute` response include
`encoded_polyline` (the server has the streets in hand), store that in the guest localStorage record, and delete
`polylineEncoder.js` plus both client-side `60`s.

**C3. `ConfigService.getCityLabelingSpeed` copy-pastes `getCrossCityLabelingSpeed`** *(2 angles)* —
`app/service/ConfigService.scala:845-846` vs `:830-839`: same `getCityLabelingSpeedBySchema` scan, same
`hours > 0 && km > 0` guard, same recover/log — differing only in cache key and unit factor (`*60.0`
minutes vs `*3600.0` seconds per 100 m). A formula fix applied to one silently skews the other, and the 60×
unit difference is primed for a drift bug. Extract one private `labelingSpeedForSchema(schema)` in a canonical
unit; both public methods convert and cache on top.

**C4. Mile conversion re-implemented with a drifting constant** *(verified)* —
`RouteBuilder.js:969` uses `km / 1.609344` while `util.math.kmsToMiles` (utilitiesMath.js:100, loaded on every
page) uses `1.60934` — RouteBuilder mile figures are already computed with a different constant than every other
distance display in the app. Replace with `util.math.kmsToMiles(km)` (and consider fixing util.math's truncated
constant while there — 1.609344 is the exact value).

**C5. Three inconsistent great-circle implementations on one page** —
`RouteGraph.js:47` hand-rolls haversine (Earth radius 6371008.8 m) alongside `util.math.haversine`
(6372800 m) and turf's own; the same screen mixes them (`#updateStats` uses `turf.length`, `#animateExplorer`
uses `RouteGraph.distanceM`), so "distance" means subtly different things within one page. At minimum delegate
`distanceM` to `util.math.haversine` so one radius constant governs frontend distance math (the jsdom test
harness can load utilitiesMath.js the same way it loads RouteGraph.js).

**C6. Map-paint colors hardcode design-token hexes despite an established pattern** —
`RouteBuilder.js:513` (`'#B3B3B3'` = `--color-neutral-500`) and `:392/:407/:576` (`'#2D2A3F'` =
`--color-asphalt-500`), with a comment claiming map paint can't read CSS tokens —
but `public/js/ps-map/addStreetsToMap.js:16-19` already resolves the same tokens for Mapbox paint via
`getComputedStyle(document.documentElement).getPropertyValue(...)`. A token retune would update every ps-map
layer and leave RouteBuilder stale. Use the getComputedStyle pattern (one const per token at setup).

**C7. MapboxSearchBox mount boilerplate duplicated** —
`DirectionsPanel.js:49` (`#buildSearchBox`) re-implements the setup established in
`public/js/labelMapLocationSearch.js:151-168` (accessToken, language, placeholder workaround, bbox limiting,
onAdd-into-container). A Search-JS upgrade quirk fixed on one page won't reach the other. Extract a shared mount
helper in `public/js/common/`; also fix `labelMapLocationSearch.js:9`, whose header still says it "Mirrors the
setup in routeBuilder.js (#setUpSearchBox)" — a file/method this PR deletes.

**C8. Share-link construction hand-built in three files** —
`SavedRoutesPanel.js:192`, `MyRoutes.js:57-60`, `RouteBuilder.js:1592` each assemble
`${origin}/r/${slug}` with the `/explore?routeId=` fallback (the fallback rule duplicated in two of them).
Changing the link shape needs three synchronized edits across two separately-bundled apps. One tiny shared helper
in `public/js/common/` — or a `share_url` field returned by the backend next to `slug` — makes it one edit.

**C9. Walking-order rule duplicated within one class** —
`TaskContainer.js:280` (`getRouteEndpoints`) and `:331` (`nextTask`) define identical inline lambdas
`routeStreetPosition ?? routeStreetId`. When the legacy fallback is retired, updating only one makes the
minimap's start/finish flags disagree with the actual walk order. Hoist to a single `#walkOrder(task)` (or
`Task.getWalkOrder()`).

**C10. Controller validation twins (and homed in the wrong layer)** *(2 angles)* —
`RouteBuilderController.scala:25/:38`: `routeNameError` and `routeDescriptionError` are 13-line copy-paste twins
differing only in max-length and message-key segment, and both keep ProfanityGuard/length business validation in
the controller while sibling features (`UserService:414`, `StoryService:393`) run identical checks in the
service layer — so `RouteService.saveRoute/updateRoute` accept unvalidated text from any future entry point.
Collapse to one parameterized validator, preferably homed in `RouteService` with the controller localizing the
returned error key.

### Simplification

**C11. UndoStack's action records are dead weight** —
`UndoStack.js:20`: RouteBuilder only ever pushes the constant `{type: 'waypoint'}` (`RouteBuilder.js:828`) and
`#undo` discards the popped record unread — the class is effectively a counter that syncs the Undo button, while
its docs promise a general action-record protocol nothing exercises. Make push/pop argument-free (or inline a
counter); reintroduce records when a second action type appears. (Note: correctness finding #17 will naturally
force this design decision.)

**C12. `#status.neighborhoodsLoaded` / `#status.streetsLoaded` mirror data presence** —
`RouteBuilder.js:45`: each flag is set in the same statement that assigns `#neighborhoodData` / `#streetData`
and never varies independently. Delete both and test `!== null` at the three read sites, leaving `#status` with
the genuinely independent latches.

**C13. `#chosenIds` duplicates the drawn features** —
`RouteBuilder.js:66`: exactly the set of `street_edge_id`s of `#streetsInRoute.features`, co-maintained at three
mutation sites. Derive it in a small `#clearChosenStates()` helper instead.

**C14. `#clearRoute`'s event parameter is dead** —
`RouteBuilder.js:1531`: the guard `if (e && e.target && e.target.id === 'delete-route-button')` is always true
at its only call site (the delete-route-button listener, line 145). Drop the parameter and log unconditionally.

**C15. Spec request boilerplate re-rolled** —
`RouteBuilderControllerSpec.scala:308/:324/:338` inline three 7-line `FakeRequest(PUT ...)` blocks though the
file's own `putRoute` helper (line 94) exists, and the 3-line DELETE incantation is copy-pasted five times.
Use `putRoute` and add a one-line `deleteRoute` helper.

### Efficiency

**C16. `#recompute` is O(routeStreets × cityStreets) per edit** —
`RouteBuilder.js:861`: every edit re-runs A* for *every* consecutive waypoint pair (each `route()` call doing two
full-city `snapToStreet` scans), and loaded saved routes get a waypoint per street — so editing a 200-street
route runs ~200 A* searches and ~400 full-city scans per click/undo/reverse. `#addWaypoint` also routes the new
segment for its reachability check and then `#recompute` discards and recomputes it. Cache street lists per
unchanged waypoint pair and only route the changed segment; resolve stored waypoints via RouteGraph's O(1)
quantized-cell node lookup.

**C17. `snapToStreet` scans every street in the city per pointer frame** —
`RouteGraph.js:106`: iterates all features (even with a regionId filter) with a haversine apiece, and
`#updateGhost` calls it every rAF while the mouse moves (~60×/s) — hundreds of ms of CPU per second of movement
in a large city. Bucket `#features` by `region_id` at construction, or index endpoints in the existing
quantized-cell grid and search outward from the pointer's cell.

**C18. Linear `features.find()` per routed street** —
`RouteBuilder.js:864` (and again in `#drawStreetList` at `:1242`): each routed street is located by scanning the
entire city street array — ~6M comparisons per edit for a 200-street route in a 30k-street city. RouteGraph
already holds a `Map<street_edge_id, feature>`; expose a `getFeature(streetId)` accessor and use it in both
places.

**C19. Route listings recompute geometry on every request** —
`RouteTable.scala:147` (`getRoutesForUser`): re-runs `ST_Transform(26918)` + `ST_Length` over every street of
every route, and the companion street-geometries fetch re-encodes thumbnail polylines — on every dashboard load,
every RouteBuilder page load, and after each save. Persist `distance_meters` and `encoded_polyline` (and
`street_count`) as columns on `route`, written when the street list changes. (This also unlocks the C1/C2
backend-thumbnail fix.)

**C20. Independent queries serialized in `getRoutesForUser`** —
`RouteService.scala:128`: the usage-counts and street-geometries queries run sequentially in a for-comprehension
though independent, adding a full query's latency to every listing. Start both `db.run` futures before the
for-comprehension (or zip them).

**C21. `#updateStats` re-measures lengths RouteGraph already cached** —
`RouteBuilder.js:922`: every recompute re-runs `turf.length` over all route streets though RouteGraph computed
each street's length into `#featureLengths` at construction (and `#handleRouteSaved` repeats the reduce a third
time). Expose the cached lengths or accumulate from the `weightM` values already summed during routing.

**C22. Route progress recomputes the route's total distance on every update** —
`MissionController.js:154`: `updateMissionProgress` recomputes
`taskContainer.totalLineDistanceInNeighborhood` — `turf.length` over every task in the route — on each pano
position change, though the total is constant for the session. Compute once when tasks finish loading and cache.

### Altitude / conventions

**C23. Route-end fix layered as a call-site heuristic instead of fixing `Task.isAtEnd`** —
`NavigationService.js:323`: the final-street logic (`isRoute && no nextTask && walked >= 0.9`) is layered around
the fixed 25 m `END_OF_STREET_THRESHOLD`, leaving the root cause — 25 m is most of a short street — to fire on
short non-final streets, with behavior governed by two magic numbers in two classes plus a route-only special
case. Cap the threshold inside `Task.isAtEnd` (e.g. `min(25 m, 40% of street length)`) to fix every caller at one
chokepoint. (Related: correctness finding #5 — fix them together.)

**C24. Missing Slick mirror for the new FK** *(verified; CLAUDE.md "Mirror each in the Slick model")* —
344.sql:37 declares `route_id INT NOT NULL REFERENCES route(route_id)` but
`RouteSlugAliasTable.scala:13-19` defines no `foreignKey(...)` (contrast `MissionTableDef` in the same PR, which
mirrors its new FK). Add `def route = foreignKey("route_slug_alias_route_id_fkey", routeId, ...)`.

**C25. Missing Slick mirror for the unique slug index** *(verified)* —
344.sql:44 runs `CREATE UNIQUE INDEX route_slug_idx ON route (slug);` but `RouteTable.scala` declares `slug`
(line 71) with no `index("route_slug_idx", slug, unique = true)` (contrast `RouteStreetTableDef`'s mirrored
`UNIQUE (route_id, position)` in the same PR).

**C26. `route_street.position` lacks its CHECK constraint** *(CLAUDE.md full-constraint-set rule)* —
344.sql:11/:19 add `position INT ... NOT NULL` — a non-negative ordinal (backfilled `rn - 1`, written from
`zipWithIndex`) — with no `CHECK (position >= 0)`; only the app enforces the domain. Add the CHECK with a
comment noting the invariant.

**C27. Hand-assembled font shorthands instead of `--text-*` tokens** *(CLAUDE.md design-system rule)* —
`public/css/route-builder.css:148` writes `font: 700 24px/30px var(--font-primary)` where
`font: var(--text-h3-bold); line-height: 30px;` is the sanctioned form (`--text-h3-bold` is
`700 24px/28px var(--font-primary)`), and `:110` hand-assembles `font: 700 20px/24px var(--font-accent)`. Both
also drop the `var(--ui-scale)` factor the tokens bake in, detaching this UI from Figma-driven retunes.

**C28. `SlugUtils` invariant comment cites the wrong evolution** *(verified)* —
`app/models/utils/SlugUtils.scala:21` anchors the no-consecutive-dashes invariant to "337's backfill", but the
backfill (the `--<route_id>` dedupe suffix that depends on it) lives in **344.sql** after the rebase
renumbering. A maintainer verifying the coupling will open the wrong (shipped, unrelated) evolution and may
conclude the invariant is dead. Point the comment (and any PR-body references) at 344.sql.
