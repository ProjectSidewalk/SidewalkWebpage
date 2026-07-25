# Verification verdicts (Phase 2)

## Empirically confirmed during Phase 1 (no separate verifier needed)
- RC1 CONFIRMED: RouteService.reconcileStreetsAction UNIQUE(route_id,position) transient collision → any non-append edit (reverse/insert/removal/reorder) → 23505 → PUT 500. Reproduced live (route 9) + PR's own spec test fails. 5 finder angles converged.
- RC2 CONFIRMED: test/service/ExploreAddressServiceSpec.scala:544 Mission ctor missing userRouteId → whole test suite fails to compile. Reproduced in web container.
- RC3 CONFIRMED (by me): 8 stale build artifacts (~34k lines) committed under obsolete public/javascripts/*/build/ by commit 2e14abdb6; not on develop; unreferenced; gitignore only covers public/js/*/build/.

## Self-verified quick checks (all CONFIRMED)
- SV1: public/css/admin-task.css:83 references deleted /assets/images/icons/routebuilder/start-point.png (file gone) → invisible user marker on admin task playback.
- SV2: RouteBuilder.js:969 uses 1.609344 vs util.math.kmsToMiles's 1.60934 (utilitiesMath.js:100) — duplicated conversion with constant drift.
- SV3: RouteSlugAliasTable has no foreignKey mirror; RouteTable has no unique index mirror for route_slug_idx (344.sql:44). CLAUDE.md mirror rule violated.
- SV4: SlugUtils.scala:21 cites "337's backfill" but the backfill is in 344.sql (rebase renumbering) — stale cross-reference on a real invariant.

## Verifier agents
- V1 insertIfNew .head (AuditTaskUserRouteTable.scala:68-76): CONFIRMED. Out-and-back route: second traversal row never linked (no position/routeStreetId disambiguation; only audit_task_id unique), updateCompleteness never completes, getRouteTask re-serves street forever. Fix: persist/pass served routeStreetId through submission.
- V2 empty-streets save → Explore 500: CONFIRMED. No minLength on streets Reads (RouteBuilderFormats:26), saveRoute has no check (vs updateRoute:107-108), route branch yields None at distance 0 (MissionService:218-223), ExploreService:250 .map(_.get) throws. Also invisible in listings (inner join, RouteTable:127-135) so owner can't delete via UI. Nuance: only post-onboarding users crash.
- V3 344.sql Downs: CONFIRMED. Downs:72 re-adds UNIQUE(route_id,street_edge_id) with no dedup; out-and-back rows make Down fail. Correction: autocommit=false → transaction rolls back fully (not half-reverted), but autoApplyDowns=true means switching a dev DB back to develop bricks startup until manual fix. Fix: dedup first or omit the re-add.
- V4 flip direction (RouteGraph.js:217-218): CONFIRMED empirically (Node repro): failure band = endpoint separation in [10m, 15m) (below 10m no edge exists; control at 17.8m correct). Wrong reverse flag persisted; Explore walks street backwards. Also long curved streets with endpoints 10-15m apart qualify.
- V5 short-street no-edge (RouteGraph.js:33, route():164, RouteBuilder.js:862, 1325-1335): CONFIRMED. Streets with endpoint separation <10m get no edges; loading a saved route containing one drops it (generic 'route-adjusted' toast only), baseline reset post-drop, Update PUTs the loss. DB: 2,246/23,995 open Seattle streets qualify; seeded routes 12 and 48 already contain such streets. New builder can't create them; legacy/loaded routes affected.
- V6 parallel-edge substitution (RouteBuilder.js:1271-1335): CONFIRMED. Boundary-only waypoints; A* picks lower-weightM parallel edge; count-only adjustment detection (1330) misses 1-for-1 swap; baseline snapshotted post-substitution → reads 'Saved'. Wrong street persists on next edit+Update; loaded view misrepresents stored route.
- V7 save double-submit (SaveModal.js:47,51-53,139-177): CONFIRMED. No in-flight guard/disable; modal hidden only in success handler; keydown lacks e.repeat check; backend saveRoute inserts unconditionally, slug logic makes duplicates succeed as name-2, name-3.
- V8 Start-field append (RouteBuilder.js:228, 818-827; DirectionsPanel.js:70-80): CONFIRMED. onSetStart → #addWaypoint always routes from current tail and appends; Start box stays interactive while building (CSS keeps block visible; panel never disables). Contradicts DirectionsPanel's own doc. Minor: label self-corrects on next reverse-geocode but wrong waypoint already appended.
- V9 undo-after-reverse (RouteBuilder.js:1124-1142, UndoStack.js:39-41): CONFIRMED. #reverseRoute neither pushes nor clears; #undo pops stale entry and waypoints.pop() removes original start (now finish); repeated undo eats wrong end.
- V10 preview-vs-draft (RouteBuilder.js:1200-1208, 1288-1292, 1320, 1431-1432): CONFIRMED. ?preview= branch preempts draft restore; URL param persists across F5 (no replaceState); #unsavedWorkConfirmed no-ops on fresh page; #emptyRoute's #saveDraft(0 waypoints) deletes the draft. Same-tab reachable from dashboard link. Fix: prefer matching draft on reload.
- V11 load race: PENDING
- V12 region bypass off-viewport: PENDING
- V13 guest stale card: PENDING
- V14 usage-count inflation: PENDING
- V15 reverse-geocode race: PENDING
- V16 silent blank load: PENDING

## Batch-2 verdicts
- V11 load race (RouteBuilder.js:1316-1337): CONFIRMED. No abort/sequence guard; streetsRendered is a one-time init flag; cards stay clickable; #unsavedWorkConfirmed no-ops while first fetch in flight. Last response wins: user clicked B last but silently edits A (map, active card, draft all A). Also races the ?preview deep-link load.
- V15 reverse-geocode race (DirectionsPanel.js:203-228): CONFIRMED, modest severity. Dispatch-time #lastGeocoded bookkeeping means guard never blocks newer request; stale response overwrites End field + #endpointStreets; #suggestedRouteName can persist stale 'X to Y' name server-side if accepted. Self-heals on next >15 m move.
- V14 usage counts (RouteTable.scala:164-170): CONFIRMED. group.length counts rows; no countDistinct(userId); completed row not reused by getActiveRouteOrCreateNew so repeat visits insert new rows; tooltip (routebuilder.json:21) explicitly promises 'how many people'. One person reported as two. Discarded rows correctly excluded.
- V12 region bypass (RouteBuilder.js:658-662, 805-811): CONFIRMED. #regionIdAtPoint = queryRenderedFeatures only (no geometry fallback); off-viewport geocoded address → null region → refusal skipped; snapToStreet has NO max snap distance → route silently extends to arbitrary boundary street of locked region. DirectionsPanel retrieve adds waypoint before any camera move.
- V13 guest stale card (RouteBuilder.js:1364-1367, 1583-1595; SavedRoutesPanel.js:76-77): CONFIRMED. recordGuestRoute only called on first save; PUT success path only refresh()es which re-reads localStorage; guests CAN update (SecuredAction, anonymous identity owns route). Card shows first-save distance/thumbnail forever. Signed-in unaffected.
- V16 silent blank load (RouteBuilder.js:1315-1323): CONFIRMED with correction — trigger is a saved route whose street ids all have non-Open status by load time (hide-streets-without-imagery / closed region), since /contribution/streets/all serves only Open streets while the route-streets endpoint applies no status filter. #emptyRoute wipes work + draft + undo before the bare return at :1323; no feedback. Partial-drop case does toast; only all-gone falls through.
