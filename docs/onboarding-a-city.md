# Onboarding a city

How a new deployment goes from "we'd like Project Sidewalk in X" to a schema on the server, using the tooling in this
repo. It replaces the QGIS-by-hand runbook that used to live in the wiki for everything but the visual QA, and takes
an afternoon rather than days (#4291); the retired runbook's last revision stays readable in the
[wiki page's history](https://github.com/ProjectSidewalk/SidewalkWebpage/wiki/Creating-database-for-a-new-city/fdd8da7)
for the manual QGIS steps. The `onboard-city` Claude Code skill drives this same sequence with the judgment calls
filled in.

```
make build-city-data id=<city-id> args="..."          # 1. streets + regions → db/onboarding/<city-id>/  (minutes)
make check-imagery   id=<city-id> args="--sample --gsv" # 2. imagery preflight, one row per provider     (minutes)
make onboard-city    id=<city-id>                      # 3. configs, GA, schema, fill, scan, dump        (scan: ~1 h)
```

Run the three from the **main checkout**: `db/` is the bind mount the db container sees at `/opt`, so a worktree's
`db/onboarding/` and `db/scripts/` are invisible to it. Everything under `db/onboarding/` is git-ignored.

## Before you start

- **City id** — lowercase kebab-case ending in the state for US cities (`laurens-ia`), the country elsewhere
  (`bayonne-fr`). The id becomes `SIDEWALK_CITY_ID`, the schema (`sidewalk_laurens_ia` — new cities keep the full
  id), and the output dir.
- **Server name** — the id without its suffix (`sidewalk-laurens`), unless a clearly larger city shares the name
  (`sidewalk-newport-ky`).
- **Neighborhood boundaries** — the thing worth spending time on, in order of preference:
  1. a dataset from the partner or the city (any OGR-readable format and CRS; note its name column);
  2. the city's open-data portal (ArcGIS Hub, Socrata, CKAN, data.gouv.fr, …) — look for official, non-overlapping
     polygons that tile the city;
  3. what the tool finds on its own: OSM neighbourhood polygons (used only when they cover ≥ 75% of the city), then
     US census tracts, then the whole city as one region (fine for a small town).
  Whatever you use, record where it came from with `--regions-source` (a URL, or the collaborator's email); it is
  stored in `region.data_source`.
  A town small enough to come out as **one region** is named after the city, not after whatever source it landed in
  — Laurens, IA would otherwise be the neighbourhood "Census Tract 7801" everywhere a region name shows (missions,
  the dashboard, LabelMap's filters, the API's `region_name`). The name comes from `--place`; pass
  `--single-region-name` when the boundary came from a file, or to choose a different one. A name you picked
  yourself — a `--regions-file` dataset, or a `--merge-regions` target — is never second-guessed.
- **Imagery provider** — `gsv`, `mapillary`, `panoramax`, or `infra3d`. The preflight in step 2 tells you which
  actually covers the city. The web container needs the provider's credentials for the scan (Panoramax needs none).
- **The web image** must carry the geo stack (`osmnx`, `geopandas` — in `requirements-offline-tools.txt`). It is
  installed at image build time, so after pulling a branch that adds it: `docker compose build web` and recreate the
  container.

## 1. Build the streets and regions

```
make build-city-data id=laurens-ia args="--place 'Laurens, Iowa, USA'"
make build-city-data id=bayonne-fr args="--boundary-file bayonne.geojson --regions-file quartiers.geojson \
    --region-name-col nom --regions-source 'https://www.data.gouv.fr/… (Ville de Bayonne, Licence Ouverte 2.0)'"
```

`scripts/onboard_city.py` geocodes the boundary (or reads yours), fetches the streets from OpenStreetMap with the
same highway filter the QGIS runbook used (`--include-alleys` for `service=alley`), splits them only where included
ways meet, and applies the anti-tiny-segment rules from #4717: pieces under 20 m left between close intersections
(roundabout arcs, dual-carriageway stubs) merge back into a touching piece of the same OSM way, never closing a ring;
region-boundary fragments under 30 m are reabsorbed; a street running *along* a boundary is merged back together
rather than left cut; boundary-hugging streets get their truncated ends back. Regions are clipped to the city,
slivers absorbed into their neighbour, and ids assigned densely by name.

It never touches the database. It writes, under `db/onboarding/<city-id>/`:

| File | What for |
|---|---|
| `report.md` | Read this first: street count, km, the **tiny-segment share** (production averages 18% under 20 m; Bayonne rebuilt at 4%), loop roads (start = end — kept as OSM maps them), regions flagged `OVERSIZED` (> 60 km of streets — split it), `SPARSE`/`EMPTY` (fold it), region-name warnings (#4620; a repeated source name is kept as separate regions, `"X (2)"`), boundary coverage. |
| `<city-id>_qa.gpkg` | The QA GeoPackage for QGIS: `qgis_road`, `qgis_region`, `city_boundary`, plus `dropped_segments` and `rider_merges` so you can see what the rules did. |
| `qgis_tables.sql` | The staging tables `fill-new-schema.sh` consumes (`qgis_road`: `road_id`, `osm_ids bigint[]`, `highway`, `region_id`, `geom`; `qgis_region`: `region_id`, `name`, `data_source`, `geom`). |
| `street_edge_endpoints.csv` | The imagery scan's input, so step 2 can run before any database exists. |

**The QA loop.** Open the GeoPackage in QGIS over a basemap and look at the boundary, the dropped segments, and any
flagged region. Two ways back:

- *Parameters:* rerun with different flags. `--merge-regions "Census Tract 513:Census Tract 523.01"` folds a sparse
  region into its neighbour by **name** and reruns the whole assignment, so streets re-split against the merged
  boundary and ids stay dense. Thresholds: `--merge-tiny-m`, `--heal-segment-m`, `--boundary-merge-tol-m`,
  `--min-segment-m`, `--max-region-street-km`.
- *Hand edits:* delete a street, reassign its `region_id`, move a boundary, rename a region — in the GeoPackage — then
  `make build-city-data id=<city-id> args="--from-gpkg"`, which validates the layers (unique ids, region references,
  geometry types, non-empty names, at least one OSM way id per street) and rewrites the SQL, report, and endpoints
  CSV so the load matches what you QA'd. Region edits big enough that streets should re-split go back in as the
  region source instead: `--regions-file <the QA gpkg> --regions-source "..."`.

Never load a stale SQL over hand edits.

## 2. Imagery preflight

```
make check-imagery id=laurens-ia args="--sample --gsv"
make check-imagery id=laurens-ia args="--sample --mapillary"
make check-imagery id=laurens-ia args="--sample --panoramax"
```

Each run checks a random 150 streets (`--sample N`, `--seed`) with the same verdict rules as the full scan and adds a
row to `db/onboarding/<city-id>/preflight_report.md`: sample size, covered, **failed**, and the oldest / median /
newest of the covered streets' newest captures (Mapillary reports no dates). A non-zero `failed` column is a key or
quota problem, not a coverage figure — the scan no longer reads Google's `OVER_QUERY_LIMIT` / `REQUEST_DENIED` as
"has imagery". Its files live under `preflight/<provider>/`, apart from the full scan's checkpoint; a rerun with the
same `N` and `--seed` resumes, a different sample replaces the row.

Below about 70% coverage, say so before going on: the full scan will hide that share of the city.

## 3. Run the setup

```
make onboard-city id=laurens-ia
make onboard-city id=laurens-ia args="--skip-scan"        # any of the script's flags go through args=
```

`tools/setup_new_city.py` is host-side and stdlib-only; it edits repo files and drives the two containers. It pauses
where a person is needed and skips whatever a previous run already did. **Run it from the main checkout**, not a
worktree — the db container mounts the main checkout's `db/` at `/opt` and the app boot compiles `/home`, so a
worktree's artifacts and evolutions are not the ones the steps would use; it refuses to start from one, except
under `--dry-run`, which only previews edits to the checkout's own `conf/` files and drives no container.

Unattended (CI, a scripted rebuild, an agent), pass `--yes`: every question takes its default, the review of the
build report included, and `--donor`, `--tutorial-region` and `--regions` set the answers that have no sensible
default. Without `--yes`, a run with nothing on stdin stops at the first question that is a choice rather than
letting it fall to nobody; only the cautious questions (keep an existing schema, stop before a dirty dump) take
their default either way.

0. **Review** — prints the report's headline numbers and the preflight table, asks to continue.
1. **Configs** — asks for the display name, country/state, provider, status (default `private`), launch date (the
   Friday of next week) and URLs, then registers the city in every per-city map of `conf/cityparams.conf` (GA ids
   empty — the layout skips the tag for an empty id), adds `city.name.<id>` (and a new state's or country's name) to
   `conf/messages/messages`, the state abbreviation to `messages.en`, the City IDs row to `docs/dev-environment.md`,
   and prints the translation keys you still owe. The false-by-default flags (`private-profiles-by-default`,
   `global-leaderboard-excluded`, `ai-label-submission-enabled`) are left unset.
2. **Google Analytics** — with `ga-service-account.json` in the repo root (one-time setup in
   `tools/create_ga_properties.py`), creates the prod and test properties inside the existing GA accounts and fills
   both the `G-…` measurement ids and the numeric property ids. Skipped with a pointer otherwise; run the script
   standalone later.
3. **Schema** — `db/scripts/create-new-schema.sh` clones a **donor** city's structure and seed rows (evolutions,
   version history, `config` with its tutorial street, tags, survey questions), creates the role, bumps the
   sequences, grants `readonly_user`. The donor defaults to the dev container's `DATABASE_USER`; pass `--donor` to
   choose. A donor is refused when it has applied an evolution beyond this checkout's highest — a dev schema that
   hosted another branch's QA, which would otherwise carry that branch's evolution into the new city. The same
   schema can also hold another branch's evolution under the *same* number, so the donor's top evolution is
   checked too: it passes when its `play_evolutions` hash is the one Play computes from this checkout's file
   (`make` and the orchestrator pass it in); otherwise every other city schema that has applied that number must
   agree with the donor, and a disagreement names the schemas so you can pick another `--donor`. (The committed
   `sidewalk_init` template is not used here: it is frozen at evolution 252 and cannot be replayed past 372, #5198.)
4. **Evolutions** — boots the app once as the new city and waits for `play_evolutions` to reach the repo's highest.
   Right after a clone it boots even when the donor was current, because Play is the one reliable check that every
   applied evolution is this checkout's (it compares hashes and, with `autoApplyDowns`, reverts and re-applies from a
   mismatch). A schema kept from a run that stopped before the fill is verified the same way, since its hashes were
   never checked either; a kept schema that already holds streets skips the boot. The boot needs `:9000` and the
   checkout it compiles, so the step asks the web container about both first (from inside it — Docker's port
   forwarder on the host accepts a connection whether or not anything listens behind it) — stop your `npm start`
   (and any `make qa-worktree`, which serves a worktree's app on `:9000` too). A worktree's own build is not in the
   way: only `target/` is per-checkout, the caches under `/home/.sbt` and `/home/.coursier` are shared by design.
   Without a terminal to ask, it stops and names what is in the way; `--allow-running-apps` boots past a build in
   the main checkout you know is idle, never past a taken port. The boot runs with the nightly actors switched off,
   so a boot that straddles one of their scheduled minutes cannot write job rows into the new schema.
5. **Load** — `qgis_tables.sql` into the schema.
6. **Fill** — `fill-new-schema.sh` with the tutorial region and which regions open at launch (`all`,
   `include:1 2 3`, `exclude:4`; or `--tutorial-region` and `--regions`). The tutorial region has to be among the
   open ones, and the script checks the pair before running the fill. It sets the city center, map bounds (region
   extent + 0.5°), and default zoom from the open regions, and prints what landed: streets, km, sub-20 m share,
   per-region km, open/closed regions. The fill is one transaction: a failure leaves the unfilled clone, and a rerun
   comes straight back to this step.
7. **Imagery scan** — exports the endpoints from the database, runs `check_streets_for_imagery.py` for the city's
   provider (resumable; an hour or so for a mid-sized city), hides the no-imagery streets, and imports the imagery-age
   summary into `street_imagery`. `--skip-scan` defers it; a rerun picks it up.
8. **Dump** — checks that nothing but onboarding has written to the schema: every table the catalog lists other
   than the ones the clone, the fill and the scan fill has to be empty, `region_completion.audited_distance` has to
   be zero and every `street_edge_priority` at 1. A local QA pass fails that (one walk in Explore leaves an
   `audit_task`, thousands of `audit_task_interaction` rows, a moved `audited_distance`), and so does a job run as
   the city (`intersection`, `cluster`, `sidewalk_presence`, `background_job_run`, …); either would ride into the
   launched city inside the dump. The step lists what it found with the statements that clear it and offers to run
   them; unattended it stops. Then `pg_dump -Fc` of the finished schema to `db/<schema>-dump`, the file
   `make import-dump` and the server both restore, and the handoff checklist. `--dump-only` runs this step alone.

## 4. What stays on a person

- **Translations.** `conf/messages/messages.zh-TW` always gets the city (and any new state or country) transliterated;
  `es`, `nl`, `de`, `pt-BR`, `fr` only where the name differs from English. `make lint-locales` must stay green.
- **The `config` row.** The clone carries the donor's `excluded_tags` (a European city may want a different set),
  `update_offset_hours` (assigned from the load-spreading spreadsheet), and `make_crops`; the fill prints all three
  and clears the donor's `mapathon_event_link`. Check them before launch.
- **Visual QA.** Land on the site as the new city (`SIDEWALK_CITY_ID` + `DATABASE_USER` in
  `docker-compose.override.yml`, recreate the container): the map centers on the city, neighborhood names read right,
  one street walks in Explore on the chosen imagery, the Explore tag lists match `excluded_tags`. Two things the
  first visit needs: sign in **before** switching the dev env to the new city — from a dev env pointed at an existing
  city — so that whatever your testing logs is attributed to a user that already exists in the production
  `sidewalk_login`; and if the landing map needs a different zoom, edit `config.default_map_zoom` and clear the Play
  cache from the admin page (it caches the config row), the same after hiding streets on a live server, since the
  total street distance behind the completion percentage is cached too.
- **What the nightly jobs still owe.** Onboarding fills only what no scheduled job can produce, so a new city's
  `intersection` table (with each street's corner links, #5095), its `cluster` table, its `sidewalk_presence`
  table, and its `osm_way` tag cache are all empty — in the dump you hand the server, too — until that city's first
  scheduled run (04:00 + its `update_offset_hours`). AccessScore reads zero until then. An admin can force the
  intersections and clusters early from `/clustering` — on the launched site, not locally: rows a local run
  produces are what the dump step then makes you clear, since a dump is meant to hold none of them. The `osm_way`
  tags come from their own nightly refresh, and until they land every intersection is `grade_separated = FALSE`,
  which is why deriving them during onboarding would not help (#5297).
- **Server.** `scp db/<schema>-dump <netid>@makelab1.cs.washington.edu:/www/sidewalk/new-city-dumps/<schema>-empty-dump`
  — the destination follows the convention every file in that directory uses, while the local name stays
  `<schema>-dump`, which is what `make import-dump` restores and what a populated prod pull is called too. (An ssh
  alias that sets the user works as well; a bare hostname without one fails with `Permission denied`.) **If you
  QA'd the city locally, dump it again first**: `make onboard-city id=<city-id> args="--dump-only"` reruns only the
  dump step, which lists everything the QA pass left — one walk in Explore leaves an `audit_task`, thousands of
  `audit_task_interaction` rows, and a moved `region_completion.audited_distance` — with the `TRUNCATE`s and
  resets that clear it, and runs them for you on a `y`. Then the IT tooling
  (`uwcseit-sidewalk-tools`: `bin/setup-new.pl`, test stage first), the Maps-key referrers for both URLs
  (`docs/google-cloud.md`), DNS, and the PR with the config, message, and docs changes. Where the tooling can't be
  used, the fallback is an email to CS support asking for the test and prod servers, with both URLs, any redirect
  from an older name, `SIDEWALK_CITY_ID`, and `DATABASE_USER`.

## Optional follow-ups

- **Pano scraper**, only when the deployment is also a computer-vision dataset: once prod is up, create the city's
  directory under `sidewalk_panos/Panoramas/<city-id>` on the panorama store, seed it with a `log.csv` carrying the
  same headers as the other cities' scraper logs (no trailing newline), and add a crontab entry for the city on the
  scraper host, copied from another city's and spaced out to a different hour. Mikey holds the access to both.
- **Uptime monitoring.** In [Uptime Robot](https://uptimerobot.com/), add an HTTP(s) monitor at a 5-minute interval
  on the `/signIn` endpoint of each stage (e.g. `https://sidewalk-<city>-test.cs.washington.edu/signIn`).
- **A launch limited to an arbitrary boundary** (streets around transit stations, say) has no tooling: phased launches
  are by region (`include:`/`exclude:` at fill time, `make reveal-or-hide-neighborhoods` later). The retired runbook's
  hand recipe for it is in the wiki page history linked above, but it predates `street_edge.status`.

## Re-running, and doing it by hand

Every step is idempotent: `make onboard-city` skips a registered city, an existing schema (unless you say drop),
applied evolutions, a filled schema, and an imported scan. `args="--dump-only"` goes straight to the dump step, so
a city that was QA'd after its first dump never has to pass the "drop and recreate?" question again. To redo the
streets after launch, the wiki's "Adding new road geometries" flow still applies — this tooling is for the first
import.

The equivalent manual sequence, for a hand-made QGIS export or a partial rerun:

```
make create-new-schema name=sidewalk_<city> donor=sidewalk_<donor>
docker exec -i projectsidewalk-db psql -v ON_ERROR_STOP=1 -U sidewalk_<city> -d sidewalk -f /opt/onboarding/<city-id>/qgis_tables.sql
make fill-new-schema                      # schema, tutorial region, regions to open
make check-imagery id=<city-id> args="--<provider>"
make hide-streets-without-imagery         # schema, onboarding/<city-id>/streets_with_no_imagery.csv
make import-street-imagery                # schema, onboarding/<city-id>/street_imagery_summary.csv
```

A hand-built `qgis_road` needs the canonical columns (`osm_ids = ARRAY[osm_id]`); `--from-gpkg` accepts a layer with
a single `osm_id` column and converts it.
