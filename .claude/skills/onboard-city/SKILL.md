---
name: onboard-city
description: Stands up a new Project Sidewalk city end to end — neighborhood data hunting, the street build and its QGIS QA loop, an imagery preflight across providers, `make onboard-city`, translations, config review, and the server handoff. The scripts do the deterministic work; this skill supplies the judgment calls around them.
---

# Onboard a city

Two commands and this skill. Read `docs/onboarding-a-city.md` once; it is the runbook this skill drives.

```
make build-city-data id=<city-id> args="..."   # scripts/onboard_city.py → db/onboarding/<city-id>/ (QA gpkg, SQL, report, endpoints csv)
make check-imagery   id=<city-id> args="--sample --<provider>"   # preflight, one row per provider in preflight_report.md
make onboard-city    id=<city-id>              # tools/setup_new_city.py → configs, GA, schema, fill, scan, dump + handoff
```

Everything under `db/onboarding/` is git-ignored. The db container sees it at `/opt/onboarding/` **only from the main
checkout** (`db/` is the bind mount), so run these from the main checkout, not a worktree.

## 1. Intake — ask before building

- **City id.** Lowercase kebab-case; US cities carry the state (`laurens-ia`), others the country only when it
  disambiguates (`bayonne`, `sao-paulo-brazil`). It becomes `SIDEWALK_CITY_ID`, the schema (`sidewalk_laurens_ia`),
  the output dir, and the server name (state dropped: `sidewalk-laurens`).
- **Imagery provider.** `gsv` unless the partner says otherwise; `mapillary` / `panoramax` / `infra3d` need the
  matching credentials in the web container (Panoramax needs none). If unsure, the preflight in step 3 decides.
- **Neighborhood boundaries**, in this order of preference, and record where they came from (`--regions-source`, a
  URL or the collaborator's email — it lands in `region.data_source`):
  1. A partner- or city-supplied dataset (any OGR format/CRS; note its name column for `--region-name-col`).
  2. The city's open-data portal (ArcGIS Hub / Socrata / CKAN / data.gouv.fr …): search "neighborhoods",
     "quartiers", "barrios", "council districts". Prefer official, non-overlapping polygons that tile the city.
  3. Let the tool fall back: OSM neighbourhood polygons (used only above 75% coverage), then US census tracts
     (TIGERweb), then the whole city as one region (small towns; split later in QGIS if it grows).
- **City boundary.** `--place "<City, State, Country>"` geocodes the OSM admin boundary; check the report's
  "Boundary:" line names the right place. A partner file goes in with `--boundary-file`.
- **Scope.** Whole city, or a phased launch opening some regions first (`onboard-city` asks; the imagery scan
  covers everything either way).

## 2. Build and QA the streets

```
make build-city-data id=laurens-ia args="--place 'Laurens, Iowa, USA'"
make build-city-data id=bayonne args="--boundary-file /path/city.geojson --regions-file /path/quartiers.geojson \
    --region-name-col nom --regions-source 'https://…'"
```

Read `db/onboarding/<city-id>/report.md` before anything else and put the numbers in front of the maintainer:

- **Tiny segments (#4717):** the sub-20 m share should be at or below the production average (18%). Bayonne came in
  at 16%. Higher means the tier-1 merge is being defeated — check `--merge-tiny-m` and whether the source data is
  split oddly.
- **Regions:** `OVERSIZED` (> 60 km of streets) means split in QGIS; `SPARSE`/`EMPTY` means fold into a neighbour
  with `--merge-regions "A:B"` (names, not ids) and rerun. Seattle's regions carry 20–36 km each.
- **Region name warnings (#4620):** ALL CAPS, stray whitespace, duplicates. Fix in the source or in QGIS.
- **Coverage:** regions should cover ≥ 95% of the boundary; streets outside every region are trimmed.

Then the human QA gate: open `<city-id>_qa.gpkg` in QGIS (`qgis_road`, `qgis_region`, `city_boundary`,
`dropped_segments`, `rider_merges`) over a basemap. Fixes come back two ways: parameter changes rerun the build;
hand edits (delete a street, move a boundary, rename a region) are re-exported with
`make build-city-data id=<city-id> args="--from-gpkg"`, which validates the layers and rewrites the SQL. Never
load a stale SQL over hand edits.

## 3. Imagery preflight — before any database work

```
make check-imagery id=<city-id> args="--sample --gsv"
make check-imagery id=<city-id> args="--sample --mapillary"     # run every plausible provider
```

Each run adds a row to `preflight_report.md`: coverage of a 150-street sample, failures, and how fresh the newest
captures are. Recommend the provider from that table; a `failed` count that is not zero means a key or quota
problem, not a coverage figure. Under ~70% coverage, say so plainly before continuing — the full scan will hide
that share of the city.

## 4. Run the setup

```
make onboard-city id=<city-id>
```

It shows the report and preflight, asks for the display name, country/state, provider, status (default private),
launch date (the Friday of next week), and URLs; registers the city in `conf/cityparams.conf`, `conf/messages`, and
the docs City IDs table; creates GA properties when `ga-service-account.json` is present; clones a donor schema
(the dev container's city by default — pass `--donor` if that schema hosted another branch's evolution); boots the app
once to apply any missing evolutions; loads and fills; runs the full imagery scan for the chosen provider; dumps the
schema to `db/<schema>-dump`; prints the handoff. Rerunning skips finished steps; `--skip-scan` defers the scan;
`--dry-run` previews the file edits.

Watch the fill's closing summary (streets, km, sub-20 m share, per-region km, center/zoom) against the report.

## 5. What the scripts leave to you

- **Translations.** The orchestrator prints the exact keys. `messages.zh-TW` always gets the city (and any new state
  or country) transliterated; `es`/`nl`/`de`/`pt-BR`/`fr` only where the exonym differs from English (`Nueva York`,
  `États-Unis`). English city/state/country names go in the base `messages` (proper nouns are language-neutral);
  the US state abbreviation goes in `messages.en`. `make lint-locales` must stay green.
- **`config` row review.** The clone carries the donor's `excluded_tags` (a European city may want a different tag
  set) and `update_offset_hours` (Mikey's load-spreading spreadsheet assigns these). Ask; don't guess.
- **Optional flags** left unset on purpose: `private-profiles-by-default`, `global-leaderboard-excluded`,
  `ai-label-submission-enabled` (all false by default).
- **GA.** If step 2 was skipped, `python3 tools/create_ga_properties.py <city-id>` fills both id maps later; new
  properties go inside the existing "Project Sidewalk - Prod/Test" accounts, never new accounts.
- **Docs.** The City IDs row is added for you; `docs/dev-environment.md` is a convenience copy of `cityparams.conf`.

## 6. Hand it off

Follow the checklist the orchestrator prints: dump to the server, the IT tooling's `setup-new.pl`, Maps-key
referrers, DNS, then the PR (configs + messages + docs). Point the maintainer at the QA items only a person can do:
open the landing page as the new city (map centered, neighborhood names right), walk one street in Explore on the
chosen imagery, check the Explore tag lists against `excluded_tags`.
