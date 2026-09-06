# `db/scripts/` — database lifecycle & maintenance scripts

These are the shell and SQL utilities that **set up and maintain the Project Sidewalk Postgres + PostGIS database** for
local development, CI, and (for a couple of them) the production servers. They are deliberately thin: the real work is
done by `psql` / `pg_restore` against the database, and these scripts are the orchestration and guardrails around them.

If you're just trying to get a working dev database, you almost never call these directly — you use the `make` targets
(see [Quick start](#quick-start)). Read on when you need to understand what those targets do, add a new city, or run a
maintenance operation.

## How these run (the important mental model)

- The whole `db/` directory is **bind-mounted into the `projectsidewalk-db` container at `/opt`** (see
  `docker-compose.yml`). So inside the container, this directory is `/opt/scripts/`, and the dump files are
  `/opt/<name>-dump`. That's why scripts reference `/opt/...` paths and source `/opt/scripts/helpers.sh`.
- Most scripts are invoked through **`make` targets** that `docker exec` into the running db container. You generally
  run `make <target>` from the **host**, from the repo root.
- The interactive scripts (`fill-new-schema.sh`, `hide-streets-without-imagery.sh`, `import-street-imagery.sh`) also
  take their answers as **optional positional args** (each script's header lists them) — that's how
  `tools/setup_new_city.py` drives them; run without args they prompt as usual.
- `init.sh` is special: it is **not** a `make` target. Postgres' official image runs it **once, automatically**, on the
  first boot of a fresh data volume (it's mounted into `/docker-entrypoint-initdb.d/`).
- The data is **seeded from binary `pg_restore` dumps**, not regenerated from Play evolutions. A full city is hundreds
  of MB of GIS data; restoring a dump is far faster and more reliable than rebuilding it. Evolutions then apply schema
  changes on top at app startup.

## Quick start

```bash
make dev                      # bring up the db container (init.sh runs automatically on a fresh volume)
make import-users             # load the shared login schema (sidewalk_login) from sidewalk_users-dump
make import-dump db=sidewalk_seattle   # load a city's data from sidewalk_seattle-dump
```

`db=` defaults to `sidewalk`, so always pass the city you want (e.g. `db=sidewalk_seattle`). Dump files for real cities
are **git-ignored** and must be placed in `db/` yourself; see [`docs/dev-environment.md`](../../docs/dev-environment.md).

## The files

| File | `make` target | What it does | When you need it |
|------|---------------|--------------|------------------|
| `init.sh` | _(automatic on first boot)_ | Creates the `sidewalk` DB + roles, enables PostGIS, restores the committed **template** dumps (`sidewalk_init-dump`, `sidewalk_init_users-dump`), seeds the `SidewalkAI` user and read-only `readonly_user` role, and switches local auth to `trust`. | Never run by hand — it runs itself on a fresh db volume. |
| `import-users.sh` | `make import-users` | Drops and reloads the shared **login schema** (`sidewalk_login`) from `sidewalk_users-dump` (~900 MB); re-grants read-only afterward. | After first boot, and whenever you refresh the users dump. |
| `import-dump.sh` | `make import-dump db=<schema>` | Drops and reloads **one city's schema** from `<schema>-dump`; recreates the role, sets its `search_path`, re-grants read-only. | To load or refresh a city's data. |
| `create-new-schema.sh` | `make create-new-schema name=<schema> donor=<schema>` | Builds a **brand-new empty city schema** by cloning a live city's structure plus its seed rows (evolutions, version, `config` + tutorial street, tags, surveys) and bumping the sequences. Refuses a donor that has applied an evolution beyond the checkout's highest (`make` passes it). The committed template is no longer used here — it is frozen at evolution 252 and can't be replayed past 372 (#5198). | When standing up a city you don't yet have a dump for. |
| `fill-new-schema.sh` | `make fill-new-schema` | Populates a new city's `street_edge` / `region` / priority tables from the **staging tables** (`qgis_road`, `qgis_region` — from `scripts/onboard_city.py` or a QGIS export), relocates the seeded tutorial street past the imported ids, sets the city center, map bounds, and zoom from the open regions, and prints what landed. | After `create-new-schema` + loading the staging SQL, to bring the city online. |
| `hide-streets-without-imagery.sh` | `make hide-streets-without-imagery` | Marks streets listed in a CSV as `status = 'no_imagery'` so they're not handed out for auditing. | After running `check_streets_for_imagery.py`. |
| `reveal-or-hide-neighborhoods.sh` | `make reveal-or-hide-neighborhoods` | Opens or closes whole **regions** for auditing (flips `region.deleted` + street status between `open`/`closed`); relocates the tutorial street if its region is hidden. | Phased city launches; pulling a region back. |
| `import-street-imagery.sh` | `make import-street-imagery` | Ingests `check_streets_for_imagery.py`'s per-street imagery summary CSV into the `street_imagery` table. | When backfilling imagery-age data for a city (#4348). |
| `lint-evolutions.sh` | `make lint-evolutions` | **Static lint** for `conf/evolutions/default/*.sql` (catches semicolons mid-comment and missing `!Ups`/`!Downs` markers). Runs in CI. | Automatically in CI; run locally before pushing an evolution. |
| `helpers.sh` | _(sourced, not run)_ | Shared bash functions: `prompt_with_default`, `read_street_ids_from_csv`, `mark_streets_no_imagery` (which takes a `street_edge_status_change_source` value as its second argument), and `run_with_progress` (the spinner/clock used by the restore scripts). | Never directly — it's `source`d by the others. |
| `remove_streets.sql` | _(run by hand in psql)_ | **Playbook** to remove a set of `street_edge`s (soft-delete if they have work, hard-delete otherwise), with a preview and `ROLLBACK` guard. | One-off cleanup of bad/duplicate streets. |
| `remove_validations.sql` | _(run by hand in psql)_ | **Playbook** to remove a set of `label_validation`s and reconcile the derived counts, with a preview and `ROLLBACK` guard. | One-off cleanup (e.g. self-validations from a past bug). |

## Typical workflows

**Fresh dev database (the common case):**

```
make dev  ─▶  init.sh (auto)  ─▶  make import-users  ─▶  make import-dump db=sidewalk_seattle
```

**Standing up a brand-new city (no dump yet):** the whole sequence, from open data to a server-ready dump, is
[`docs/onboarding-a-city.md`](../../docs/onboarding-a-city.md). In short:

```
make build-city-data id=<city-id> args="--place '<City, State, Country>'"   # scripts/onboard_city.py → db/onboarding/<city-id>/
make check-imagery   id=<city-id> args="--sample --gsv"                       # imagery preflight, per provider
make onboard-city    id=<city-id>                                             # tools/setup_new_city.py: configs, GA, schema, fill, scan, dump
```

`onboard-city` drives the scripts here in this order — the same steps by hand, for a QGIS export or a partial rerun:

```
make create-new-schema name=sidewalk_<city> donor=sidewalk_<donor>   # clone a current city's structure + seed rows
# …load qgis_road + qgis_region into the schema (onboard_city.py writes a psql-loadable qgis_tables.sql)…
make fill-new-schema                                                  # streets, regions, tutorial, center/bounds/zoom
make check-imagery id=<city-id> args="--<provider>"                   # full imagery scan (an hour for a mid-sized city)
make hide-streets-without-imagery                                     # onboarding/<city-id>/streets_with_no_imagery.csv
make import-street-imagery                                            # onboarding/<city-id>/street_imagery_summary.csv
```

Run these from the **main checkout**: `db/` is what the container sees at `/opt`, so a worktree's `db/onboarding/`
and `db/scripts/` are invisible to it.

**Ongoing maintenance:**

- Open/close neighborhoods: `make reveal-or-hide-neighborhoods`
- Mark no-imagery streets: `make hide-streets-without-imagery`
- Remove specific streets / validations: run `remove_streets.sql` / `remove_validations.sql` by hand (below).

**Running the `.sql` playbooks** (they are not automated on purpose — they're destructive and want a human in the loop):

```bash
docker exec -it projectsidewalk-db psql -U sidewalk -d sidewalk -f /opt/scripts/remove_streets.sql
```

Each file runs inside a `BEGIN; … COMMIT;` block with a **preview query** in the middle — read the preview, then commit
or `ROLLBACK`. Edit the candidate-id list and the `search_path` (target city schema) at the top before running.

## Gotchas

- **Restores kill all DB connections.** `import-users.sh` and `import-dump.sh` call `pg_terminate_backend` on every
  connection to the `sidewalk` database before dropping a schema. If the web app (`npm start`) is running, its
  connections are killed — that's expected; sbt reconnects.
- **Dump files must exist in `db/`, named `<schema>-dump`.** Real city dumps are **git-ignored**; only the small
  `sidewalk_init-dump` / `sidewalk_init_users-dump` templates are committed. The scripts now fail with a clear message
  if a dump is missing, rather than a cryptic `pg_restore` error.
- **Schema / city names must be valid bare SQL identifiers** (`^[a-z][a-z0-9_]*$`) — they're interpolated into DDL.
  `import-dump.sh` and `create-new-schema.sh` validate this.
- **Large restores can run for a minute or more.** The ~900 MB users dump is the slowest (~1 min). The restore scripts
  show a live elapsed-time clock and run `pg_restore` in parallel (`-j`), but it's still a wait — don't assume it's hung.
- **`init.sh` only runs on a fresh volume.** Editing it does nothing to an existing dev DB until you recreate the volume
  (`make docker-stop` + remove the db volume, or `docker compose down -v`).
- **`reveal-or-hide-neighborhoods.sh` has a server mode** (test/prod) with different connection params; the default is
  local. Only run the server mode if you know what you're doing.
- **Inspect the DB read-only** with the `readonly_user` role (created by `init.sh`): it has `SELECT` only — never use
  `-U sidewalk` for exploration. The import scripts re-grant it after each restore, so read access survives re-imports.
- **Maintenance scripts assume the *current* (post-evolution) schema.** A freshly imported dump sits at whatever schema
  version it was dumped at; Play applies pending evolutions only when the **app next starts**. So right after
  `import-dump`, a script like `reveal-or-hide-neighborhoods.sh` can fail with `column ... does not exist` (e.g.
  `street_edge.status` from evolution 325 / #3888) because the dump is older. Start the app once against that city to
  apply pending evolutions, then re-run the script. (These run in a transaction, so such a failure rolls back cleanly.)
- **Every script that writes `street_edge.status` records the transition** in `street_edge_status_change` — old status,
  new status, and which script did it (#4928). `street_edge.status` has no application write path, so these rows are
  the only trace a run leaves, and `/admin/street-status` charts them as "what was newly identified this week". Two
  rules when editing one of these scripts: guard the `UPDATE` with `AND status <> '<new value>'` (without it, a re-run
  over the same CSV logs thousands of transitions that never happened), and write the history row in the same
  transaction as the status change. A new writer needs its own value added to the
  `street_edge_status_change_source` enum.

## Conventions for editing these scripts

- Bash scripts use `#!/usr/bin/env bash` and `set -euo pipefail` (the entrypoint-run `init.sh` stays POSIX `sh`).
- Shared logic goes in `helpers.sh`; don't duplicate prompting / CSV / progress code across scripts.
- Keep them `shellcheck`-clean (warning level) and run `bash -n` after changes.
- When writing SQL, avoid table aliases (repo-wide convention) and run destructive operations inside a transaction.
