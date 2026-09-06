# Onboarding a city

How a new deployment goes from "we'd like Project Sidewalk in X" to a schema on the server, using the tooling in this
repo. It replaces the wiki's QGIS-by-hand runbook for everything but the visual QA, and takes an afternoon rather
than days (#4291). The `onboard-city` Claude Code skill drives this same sequence with the judgment calls filled in.

```
make build-city-data id=<city-id> args="..."          # 1. streets + regions → db/onboarding/<city-id>/  (minutes)
make check-imagery   id=<city-id> args="--sample --gsv" # 2. imagery preflight, one row per provider     (minutes)
make onboard-city    id=<city-id>                      # 3. configs, GA, schema, fill, scan, dump        (scan: ~1 h)
```

Run the three from the **main checkout**: `db/` is the bind mount the db container sees at `/opt`, so a worktree's
`db/onboarding/` and `db/scripts/` are invisible to it. Everything under `db/onboarding/` is git-ignored.

## Before you start

- **City id** — lowercase kebab-case. US cities carry the state (`laurens-ia`, `walla-walla-wa`); elsewhere add
  the country only to disambiguate (`bayonne`, `sao-paulo-brazil`). The id becomes `SIDEWALK_CITY_ID`, the schema
  (`sidewalk_laurens_ia` — new cities keep the full id), the output dir, and the server name (state dropped:
  `sidewalk-laurens.cs.washington.edu`).
- **Neighborhood boundaries** — the thing worth spending time on, in order of preference:
  1. a dataset from the partner or the city (any OGR-readable format and CRS; note its name column);
  2. the city's open-data portal (ArcGIS Hub, Socrata, CKAN, data.gouv.fr, …) — look for official, non-overlapping
     polygons that tile the city;
  3. what the tool finds on its own: OSM neighbourhood polygons (used only when they cover ≥ 75% of the city), then
     US census tracts, then the whole city as one region (fine for a small town).
  Whatever you use, record where it came from with `--regions-source` (a URL, or the collaborator's email); it is
  stored in `region.data_source`.
- **Imagery provider** — `gsv`, `mapillary`, `panoramax`, or `infra3d`. The preflight in step 2 tells you which
  actually covers the city. The web container needs the provider's credentials for the scan (Panoramax needs none).
- **The web image** must carry the geo stack (`osmnx`, `geopandas` — in `requirements-offline-tools.txt`). It is
  installed at image build time, so after pulling a branch that adds it: `docker compose build web` and recreate the
  container.

## 1. Build the streets and regions

```
make build-city-data id=laurens-ia args="--place 'Laurens, Iowa, USA'"
make build-city-data id=bayonne args="--boundary-file bayonne.geojson --regions-file quartiers.geojson \
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
| `report.md` | Read this first: street count, km, the **tiny-segment share** (production averages 18% under 20 m; Bayonne rebuilt at 4%), regions flagged `OVERSIZED` (> 60 km of streets — split it), `SPARSE`/`EMPTY` (fold it), region-name warnings (#4620), boundary coverage. |
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
"has imagery". Its files live under `preflight/<provider>/`, apart from the full scan's checkpoint.

Below about 70% coverage, say so before going on: the full scan will hide that share of the city.

## 3. Run the setup

```
make onboard-city id=laurens-ia
```

`tools/setup_new_city.py` is host-side and stdlib-only; it edits repo files and drives the two containers. It pauses
where a person is needed and skips whatever a previous run already did:

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
   choose. A donor that has applied an evolution beyond this checkout's highest is refused — a dev schema that hosted
   another branch's QA would otherwise carry that evolution into the new city. (The committed `sidewalk_init`
   template is no longer used here: it is frozen at evolution 252 and cannot be replayed past 372, #5198.)
4. **Evolutions** — boots the app once as the new city and waits for `play_evolutions` to reach the repo's highest.
   A no-op when the donor was current. Your own `npm start` must be stopped for this step.
5. **Load** — `qgis_tables.sql` into the schema.
6. **Fill** — `fill-new-schema.sh` with the tutorial region and which regions open at launch (`all`,
   `include:1 2 3`, `exclude:4`). It sets the city center, map bounds (region extent + 0.5°), and default zoom from the
   open regions, and prints what landed: streets, km, sub-20 m share, per-region km, open/closed regions.
7. **Imagery scan** — exports the endpoints from the database, runs `check_streets_for_imagery.py` for the city's
   provider (resumable; an hour or so for a mid-sized city), hides the no-imagery streets, and imports the imagery-age
   summary into `street_imagery`. `--skip-scan` defers it; a rerun picks it up.
8. **Dump** — `pg_dump -Fc` of the finished schema to `db/<schema>-dump`, the file `make import-dump` and the server
   both restore, and the handoff checklist.

## 4. What stays on a person

- **Translations.** `conf/messages/messages.zh-TW` always gets the city (and any new state or country) transliterated;
  `es`, `nl`, `de`, `pt-BR`, `fr` only where the name differs from English. `make lint-locales` must stay green.
- **The `config` row.** The clone carries the donor's `excluded_tags` (a European city may want a different set) and
  `update_offset_hours` (assigned from the load-spreading spreadsheet). Check both before launch.
- **Visual QA.** Land on the site as the new city (`SIDEWALK_CITY_ID` + `DATABASE_USER` in
  `docker-compose.override.yml`, recreate the container): the map centers on the city, neighborhood names read right,
  one street walks in Explore on the chosen imagery, the Explore tag lists match `excluded_tags`.
- **Server.** `scp db/<schema>-dump makelab1.cs.washington.edu:/www/sidewalk/new-city-dumps/`, then the IT tooling
  (`uwcseit-sidewalk-tools`: `bin/setup-new.pl`, test stage first), the Maps-key referrers for both URLs
  (`docs/google-cloud.md`), DNS, and the PR with the config, message, and docs changes.

## Re-running, and doing it by hand

Every step is idempotent: `make onboard-city` skips a registered city, an existing schema (unless you say drop),
applied evolutions, a filled schema, and an imported scan. To redo the streets after launch, the wiki's "Adding new
road geometries" flow still applies — this tooling is for the first import.

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
