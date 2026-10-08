# Legacy Washington DC database migration (issue #4700)

The tooling that moved the legacy DC production database (a mid-2018 fork of this repo, offline since 2024) into the
modern per-city schema, by replaying evolutions 15 → 373 against a sandboxed copy with a patch overlay for the fork's
divergences and the legacy-data decisions. It ran once, in September 2026; `sidewalk_dc` has been a normal city schema
since. Kept because it is the only record of how DC's missions, users, regions and positions were derived. What an
analyst needs to know is in `docs/data-notes.md`; the discussion is on #4700.

## Layout

- `harness/replay.sh` applies each evolution's Ups in sequence via psql, with per-evolution logging and
  stop-on-first-error; `--reset` rebuilds the sandbox from a baseline and runs `patches/00-preclean.sql`.
- `harness/postclean.sh` exports the `dc_migration_*` audit tables, drops the scaffolding, writes mainline
  `play_evolutions` rows and diffs the shape against a modern city schema.
- `harness/gen-patches.sh` regenerates `patches/26.sql`, `179.sql` and `196.sql` mechanically from the repo
  evolutions, so their bulk provably matches mainline.
- `harness/package.sh` and `harness/login-merge.sh` turn the sandbox into a city dump and fold DC's accounts into
  the shared `sidewalk_login` (rules in `harness/login-merge.sql`).
- `patches/`: `N.sql` replaces evolution N's Ups, `N.skip` skips it, `N.pre.sql` runs before it. Each file's
  header says why it exists; `patches/16.sql`'s header is the full rule set for the mission reconstruction.

## Legacy-data decisions the overlay encodes (all Mikey's, 2026-09-02)

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
| 179 | recompute is a no-op (every DC pano width is NULL) | DC's own 2023 backport never applied either; `tools/one-off/5667-dc-label-positions.sql` did the conversion after the migration (#5667) |
| 298.pre | 37 labels with an empty pano id are deleted | what mainline 298 did in every other city |
| 338.pre | 3,773 label positions around lat 9e13 are nulled and marked `approximation2` | garbage from the legacy depth-data code; the #5667 recompute restores them |
| 360.pre | 343 panos that labels reference but `gsv_data` never recorded get stub `pano_data` rows | 360 makes the FK structural; position/angles recovered from `old_label_metadata`, dimensions by #5667 |
