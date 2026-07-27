# Legacy Washington DC database migration (issue #4700)

Tooling for migrating the legacy DC production database (frozen mid-2018 fork, offline since 2024)
into the modern per-city schema by replaying evolutions **15 → 343** against a sandboxed copy, with
a curated patch overlay for the known fork divergences. Full background, data findings, and the
landmine catalogue: [issue #4700](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/4700).

**Status: paused for discussion (2026-07-27).** The replay is green through evolution **67** —
past the highest-risk patches (16's mission synthesis, the timezone fix, the street matching).
See "Current state" below for the exact stopping point and how to resume.

## Layout

- `harness/replay.sh` — applies each evolution's Ups in sequence via psql (`;;` unescaped, matching
  Play semantics), with per-evolution logging/timing and stop-on-first-error. `--reset` re-restores
  the dump and re-applies `patches/00-preclean.sql` first.
- `harness/gen-patches.sh` — regenerates `patches/26.sql` and `patches/179.sql` mechanically from
  the repo evolutions, so their bulk provably matches mainline rather than a hand transcription.
- `patches/` — the overlay. `N.sql` replaces evolution N's Ups; `N.skip` skips it; `N.pre.sql` is
  injected before N (used at 252 for the hand-run `sidewalk_login` split, reconstructed from the
  draft evolutions deleted in commit `414bcb936`). Each file's header comment says why it exists.

## Reproducing the sandbox

The dumps live **outside the repo** (they contain user emails and password hashes — never commit
them). Current copies: `~/git/dc-migration/dumps/` on Jon's machine.

```bash
# Core-only dump (~55 MB, excludes the 135M-row interaction log — the fast iteration loop):
ssh makelab1 '/usr/pgsql-16/bin/pg_dump -p 5434 -Fc -d sidewalk_dc \
  --exclude-table-data=sidewalk.audit_task_interaction \
  --exclude-table-data=sidewalk.webpage_activity' > dc-core.dump

# Sandbox: PostGIS 16-3.4 (matches prod), database literally named "sidewalk" — required, because
# 196.sql keeps DC's config row via current_database() and 28.sql calls Find_SRID('sidewalk', ...).
docker run -d --name dc-sandbox-db -e POSTGRES_PASSWORD=sidewalk -e POSTGRES_DB=sidewalk \
  -p 127.0.0.1:5433:5432 -v dc_sandbox_pgdata:/var/lib/postgresql/data postgis/postgis:16-3.4
docker exec dc-sandbox-db psql -U postgres -d sidewalk \
  -c "CREATE ROLE sidewalk LOGIN SUPERUSER PASSWORD 'sidewalk';" -c "CREATE ROLE saugstad LOGIN;"

# Run (expects the dump at the DUMP path set in replay.sh):
harness/replay.sh --reset            # full replay 15..343 from a clean restore
harness/replay.sh 68 343             # continue from the current sandbox state
```

## Current state (2026-07-27)

- Evolutions **15–67 apply cleanly** on the core dump with the patch overlay (~30 s wall clock).
- **Next failure: 68.sql** — `duplicate key value violates unique constraint "mission_type_pkey",
  Key (mission_type_id)=(6) already exists`. Same class as the tag/label_type sequence quirks that
  129.sql later repairs: an earlier evolution inserted mission_type rows with explicit ids without
  advancing the sequence, so 68's sequence-assigned insert collides. Fix shape: a small `setval`
  before 68 (or patch 68's insert), mirroring what 129.sql does for tag/label_type.
- Not yet exercised: the `sidewalk_login` split injection at 252 (`patches/252.pre.sql`), and the
  337/338 constraint-add evolutions, which are expected to surface a handful of legacy-data
  cleanups (they were only ever verified against post-2019 city data).
- Still to build: a `999-postclean` step (drop `dc_old_label_metadata_backup` + the temp gist
  index; fossil-table inventory vs a modern schema), a `play_evolutions` fix-up so the final state
  reads as evolution 343, and the full-fidelity run against the complete dump (interaction rows
  make patched-16's `mission_id` backfill the long pole).

### Finding worth knowing before trusting coordinates

DC's Dec-2023 CV coordinate fix (its fork's evo 17, a backport of mainline 179.sql) **never
actually applied**: its recompute was gated on `gsv_data.image_width IS NOT NULL`, and its own evo
15 had just nulled every width. Verified empirically — all 271,187 backed-up coordinate pairs are
identical to the live values. So DC's `sv_image_x/y` are the original 2015–2021 values, still
carrying the client-side math bug 179.sql fixed elsewhere. The replay keeps them as-is (179's
recompute stays a provable no-op); the real fix is a post-migration follow-up: refetch GSV
metadata (width/height/camera) for still-existing panos, then run 179's recompute for labels on
those panos. Labels on expired panos have no imagery to render on, so their stale coordinates are
moot.
