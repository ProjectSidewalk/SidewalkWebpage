# Legacy Washington DC database migration (issue #4700)

Tooling for migrating the legacy DC production database (a mid-2018 fork of this repo, offline since 2024) into
the modern per-city schema by replaying evolutions **15 → current** against a sandboxed copy, with a curated patch
overlay for the fork divergences and the legacy-data decisions. Background, data findings and the landmine
catalogue: [issue #4700](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4700). The working plan with
every decision and its rationale lives outside the repo in `scratchpad/4700-dc-migration-plan.md`.

## Layout

- `harness/replay.sh` — applies each evolution's Ups in sequence via psql inside the dev db container (`;;`
  unescaped, matching Play), with per-evolution logging/timing and stop-on-first-error. `--reset` re-creates the
  sandbox as a clone of a baseline (`CREATE DATABASE … TEMPLATE`, seconds) and applies `patches/00-preclean.sql`.
- `harness/postclean.sh` — after a full replay: exports the `dc_migration_*` audit tables to CSV, drops the
  overlay's scaffolding, adds the prod-only indexes, writes mainline `play_evolutions` rows, and diffs the shape
  against a modern city schema.
- `harness/gen-patches.sh` — regenerates `patches/26.sql`, `179.sql` and `196.sql` mechanically from the repo
  evolutions, so their bulk provably matches mainline rather than a hand transcription.
- `patches/` — the overlay. `N.sql` replaces evolution N's Ups; `N.skip` skips it; `N.pre.sql` runs before N.
  Each file's header comment says why it exists. `00-preclean.sql` and `999-postclean.sql` bracket the replay.

## Sandboxes (dev `projectsidewalk-db` container)

| Database | Contents |
|---|---|
| `sidewalk_dc` | full restore of the 2026-09-02 dump incl. the 135.7 M-row interaction log (25 GB). Never mutated. |
| `sidewalk_dc_core` | same minus `audit_task_interaction` data. The iteration loop's template. |
| `sidewalk_dc_work` | what `replay.sh --reset` builds. |

The dumps contain user emails and password hashes: they live in `db/` (git-ignored), never in the repo.

```bash
cd db/dc-migration
harness/replay.sh --reset            # clone sidewalk_dc_core → sidewalk_dc_work, preclean, replay 15..HIGHEST
harness/replay.sh 68 373             # continue from the current sandbox state
harness/replay.sh --reset --from sidewalk_dc --db sidewalk_dc_full   # the full-fidelity run
harness/postclean.sh                 # shape it like a city; prints the remaining diff vs sidewalk_seattle
```

## State (2026-09-02)

- The whole chain (15 → 373) replays cleanly on the core copy, twice from scratch, in about five minutes.
- `patches/16.sql` reconstructs DC's legacy missions (per-region distance-milestone ladders) from the
  `MissionComplete` interaction events, the `mission_user` rows and, for work that predates the log, a replay of
  the ladders; Turker pay reconciles to the dollar with what the legacy app paid. The header of that file is the
  full rule set. Inputs come from `harness/extract-events.sh` and `harness/fetch-osm-ways.sh` (each run once
  against `sidewalk_dc`; the second needs network access to Overpass).
- `harness/package.sh` turns the sandbox into `db/sidewalk_dc-dump` (schemas `sidewalk_dc` + `sidewalk_dc_login`),
  `make import-dump db=sidewalk_dc` restores it into the dev database, and `harness/login-merge.sh` merges DC's
  accounts into `sidewalk_login` there (rules in `harness/login-merge.sql`). Rehearsed on the dev copy of prod's
  login schema. On prod the same three steps run against the real schema.
- The full-fidelity run (`--from sidewalk_dc --db sidewalk_dc_full`, 135.7 M interaction rows) replays clean too,
  in roughly an hour (16's placement of interactions into missions is most of it), and is packaged as
  `db/sidewalk_dc-full-dump`.
- First boot against the result found `osm_way_street_edge` empty (every cluster/raw-label/street API row inner-joins
  it). A row-count sweep of every table that is empty in DC but not in Seattle showed it was the only such gap that
  is not a feature DC never had. Both dumps were regenerated with the fill (2026-09-04).
- The merge's final `DROP SCHEMA sidewalk_dc_login CASCADE` used to take `survey_question.survey_user_role` (typed
  as that schema's `role` enum by 372) and the `label_comments_agg` view (370) with it, which the app only revealed
  at boot. The merge now re-points both at `sidewalk_login` first and refuses to drop the schema while anything in
  the city schema still depends on it. Re-running the merge after a fresh `make import-dump db=sidewalk_dc` over an
  already-merged `sidewalk_login` is a no-op for accounts (everything maps by id or email, nothing is inserted), so
  a re-import never needs `make import-users`. Avoid that anyway: the July users dump predates 372, and nothing
  would re-convert the restored login schema since every city's `play_evolutions` is already past it.

### Legacy-data decisions the overlay encodes (all Mikey's, 2026-09-02)

| Where | What | Why |
|---|---|---|
| preclean | delete the 192 superseded neighborhoods (ids 0–191) | replaced by the finer 179-region set before Sept 2016; nothing shown since referenced them |
| preclean | one region per street: largest geometric overlap wins (2,449 pairs dropped) | 338 adds `UNIQUE (street_edge_id)`; missions need one region per task |
| preclean | drop 154 IP-less anonymous tasks (duplicate-`task_start` bursts, no labels) | residue of a bug, not work |
| 16.pre | split the shared `anonymous` account into one user per IP that audited (4,055) | matches the modern one-user-per-session model; visit-only page views stay on the legacy account, as develop does today |
| 16 | missions rebuilt from milestone evidence; a mission's region is the region of the street being audited; bursts ≤ 5 s merge; replayed crossings only before 2016-09-22 and only on ladders the log never spoke for; pay only from real `mission_user` rows; every mission completed; tails < 250 ft fold into the previous mission | see the file header |
| 169.pre | `audit_task.current_mission_id` from the placement 16 recorded | 168 added the column without a backfill |
| 230.pre | populate `audit_task_interaction_small` | 229 left that to a hand-run server pass DC never got |
| 24.pre / 25.pre | `osm_way_street_edge` filled from the legacy `street_edge_parent_edge` (the OSM way ids); a street stitched from several ways takes the one covering most of it, by today's OSM geometry from `harness/fetch-osm-ways.sh` | 24 creates the table empty and no evolution fills it (new cities get it from the onboarding pipeline); the street, raw-label and cluster APIs inner-join it, so DC returned nothing |
| 26 | naive timestamps are US/Eastern before 2018-08-25, UTC after | measured against the interaction log; the server changed zones in Aug 2018 |
| 179 | recompute is a no-op (every DC pano width is NULL) | DC's own 2023 backport never applied either; positions get a post-migration recompute pass |
| 298.pre | 37 labels with an empty pano id are deleted | what mainline 298 did in every other city |
| 338.pre | 3,773 label positions around lat 9e13 are nulled and marked `approximation2` | garbage from the legacy depth-data code; the recompute pass restores them |
| 360.pre | 343 panos that labels reference but `gsv_data` never recorded get stub `pano_data` rows | 360 makes the FK structural; position/angles recovered from `old_label_metadata` |

### Finding worth knowing before trusting coordinates

DC's Dec-2023 CV coordinate fix (its fork's evo 17, a backport of mainline 179.sql) never actually applied: its
recompute was gated on `gsv_data.image_width IS NOT NULL`, and its own evo 15 had just nulled every width. All
271,187 backed-up coordinate pairs are identical to the live values. The replay keeps them as-is; the real fix is a
post-migration follow-up: refetch GSV metadata (width/height/camera) for still-existing panos, then run the
position recompute for labels on those panos.
