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
     US census tracts, then the whole city as one region (fine for a very small town);
  4. regions you draw yourself, when none of the above splits a town of more than ~20 km of streets into pieces a
     resident would recognise ("No neighbourhood data: draw your own" below; Laurens IA, Juneau AK, Evansdale IA).
  Whatever you use, record where it came from with `--regions-source` (a URL, or the collaborator's email); it is
  stored in `region.data_source`. **Regions must tile the city — never overlap.** Street pieces are cut out of the
  region polygons, so a street lying under two of them is cut twice and lands in the database twice (#3067). Those
  cuts are a leftover from when a route could not leave its region: since #3488 a region is only where a street is
  *filed* (for missions and completion), and routes run across borders freely, so the cutting is to be replaced by
  assigning each whole street to the region holding most of it (`docs/architecture.md` → "Streets, regions, and
  routes"). Until that lands, expect the border pieces in the report's tiny-segment share, and don't hand-split a
  street to make it fit a region. A city built before this tool is brought in line with it by
  `tools/one-off/4717-consolidate-tiny-streets.sql`, which applies the same merge and 15 m rules to its streets. A
  hairline where two borders were traced a metre apart is repaired for you, by giving that ground to the smaller
  region (`--max-region-sliver-m`, 5 m). An overlap thicker than that is a real disagreement about where a region
  is, so the build stops and names the pairs for you to settle in QGIS.
  A town small enough to come out as **one region** is named after the city, not after whatever source it landed in
  — Laurens, IA would otherwise be the neighbourhood "Census Tract 7801" everywhere a region name shows (missions,
  the dashboard, LabelMap's filters, the API's `region_name`). The name comes from `--place`; pass
  `--single-region-name` when the boundary came from a file, or to choose a different one. A name you picked
  yourself — a `--regions-file` dataset, a `--rename-regions` file, or a `--merge-regions` target — is never
  second-guessed.
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

`tools/city/onboard_city.py` geocodes the boundary (or reads yours), fetches the streets from OpenStreetMap with the
same highway filter the QGIS runbook used (`--include-alleys` for `service=alley`), splits them only where included
ways meet, and applies the anti-tiny-segment rules from #4717: pieces under 20 m left between close intersections
(roundabout arcs, dual-carriageway stubs) merge back into a touching piece of the same OSM way, never closing a ring;
region-boundary fragments under 30 m are reabsorbed; a street running *along* a boundary is merged back together
rather than left cut; boundary-hugging streets get their truncated ends back. Regions are clipped to the city,
slivers absorbed into their neighbour, and ids assigned densely by name.

It never touches the database. It writes, under `db/onboarding/<city-id>/`:

| File | What for |
|---|---|
| `report.md` | Read this first: street count, km, the **tiny-segment share** (production averages 18% under 20 m; Bayonne rebuilt at 4%), loop roads (start = end — kept as OSM maps them), regions flagged `OVERSIZED` (> 60 km of streets — split it), `SPARSE`/`EMPTY` (fold it), boundary coverage. |
| `<city-id>_qa.gpkg` | The QA GeoPackage for QGIS: `qgis_road`, `qgis_region`, `city_boundary`, plus `dropped_segments` and `rider_merges` so you can see what the rules did, `osm_way` (the whole OSM ways the streets were cut from) and `qgis_road_osm_way` (the stretch of each street every way covers, #5741; the report counts the streets it could not match whole, which are worth a look). |
| `qgis_tables.sql` | The staging tables `fill-new-schema.sh` consumes (`qgis_road`: `road_id`, `osm_ids bigint[]`, `highway`, `region_id`, `geom`; `qgis_region`: `region_id`, `name`, `data_source`, `geom`; `qgis_road_osm_way`: one row per street and OSM way with the shared stretch of each and `same_direction`). |
| `street_edge_endpoints.csv` | The imagery scan's input, so step 2 can run before any database exists. |
| `street_structures.csv` | Which streets lie on a bridge, in a tunnel, or under cover, from the OSM tags the build already fetched. The street-gradient export (step 8 of the setup) reads it in place of the `osm_way` cache, which is empty until the city's first nightly refresh (#5223); each row carries the street's geometry hash, so the export refuses a file from another build. It also rides in the GeoPackage's `qgis_road` layer, so a `--from-gpkg` re-export rewrites it; a hand-built layer without the column gets no file, and the grade is sampled after launch instead. |

**The QA loop.** Open the GeoPackage in QGIS over a basemap and look at the boundary, the dropped segments, and any
flagged region. In a small town, also look at every `primary` and `trunk` street. The filter keeps them because in a
city they are main streets, but a town's can be a rural highway that no home or shop faces, often divided into two
one-way carriageways with a 55 mph limit. Evansdale's Dubuque Road was 7% of the city's streets, and a test user's
first mission routed onto it. Delete such streets as a hand edit (below); dropping a highway on purpose is not the
same as dropping short segments, which #4717 rules out. Two ways back:

- *Parameters:* rerun with different flags. `--merge-regions "Census Tract 513:Census Tract 523.01"` folds a sparse
  region into its neighbour by **name** and reruns the whole assignment, so streets re-split against the merged
  boundary and ids stay dense. Thresholds: `--merge-tiny-m`, `--heal-segment-m`, `--boundary-merge-tol-m`,
  `--max-region-street-km`, `--max-region-sliver-m`. `--rename-regions` renames regions from
  `db/onboarding/<city-id>/region_renames.csv` (`current_name,new_name`); pass it on every build, since rows already
  applied are skipped. A repeated source name is kept as separate regions, `"X (2)"` (logged, not in the report).
- *Hand edits:* delete a street, reassign its `region_id`, move a boundary — in the GeoPackage — then
  `make build-city-data id=<city-id> args="--from-gpkg"`, which validates the layers (unique ids, region references,
  geometry types, non-empty names, at least one OSM way id per street, no two streets drawn on top of each other,
  no street under 15 m), re-matches the streets to the GeoPackage's `osm_way` layer (a hand-built GeoPackage without
  that layer links its streets to their way ids without positions) and rewrites the SQL, report, and endpoints CSV so
  the load matches what you QA'd. Region edits big enough that streets should re-split go back in as the region
  source instead: `--regions-file <the QA gpkg> --regions-source "..."`.

Never load a stale SQL over hand edits.

### No neighbourhood data: draw your own

A town with no neighbourhood polygons comes out of the first build as one region, or as census tracts that cut
across it. Above ~20 km of streets that is too coarse for missions and completion to mean much, so draw regions
(#6013). `tools/city/draw_regions.py` does the geometry; the judgment is yours.

**Design the regions first, on a map of the town.** What has worked:

- **Size scales with the town.** Aim for about 20–40 km of streets per region (Seattle's median is 28 km; the build
  flags a region over 60 km), the same order as each other, so a town of 300 km gets about 10. A town under ~60 km
  is the exception: it still wants a few regions so missions and completion mean something, so its regions run
  smaller (Evansdale's 54 km made nine of 4–9 km; that size would have cut Kuna's 312 km into about 45).
- **Borders on the roads people already use to give directions**: the main arterials, a freeway, a river, a rail
  line. A border that wanders through a block, or switches from one road to another mid-block, reads as arbitrary.
- **Names residents know**: the arterial (Gilbert Drive), a park or school at the region's heart (Fullerton Park,
  Bunger), the compass only when nothing better exists (East Side). A name taken from a landmark is a promise: the
  landmark must lie inside, which the tool checks (`--landmark`). Find candidates in OSM (`amenity=school`,
  `leisure=park` with a name, inside each zone). Where a region has none, as in new subdivision country, the
  county's subdivision layer names the largest development there (Kuna's Memory Ranch; Ada County publishes one).
- **Downtown is all of downtown**, both sides of the main street, not just the blocks north of it.
- **Each arterial belongs to one region per stretch.** It is labelled from one side and audited as one street, so
  it goes to the region on its *owning* side (`--divide-road "Gilbert Drive:south"`), never by whichever side its
  midpoint wobbles to. A street that leaves a region and comes back reads like a border weaving across the road,
  and the tool refuses it.

**Fix the boundary before drawing.** Legal city limits can be full of holes: Kuna's are 15 pieces with 43
unincorporated county enclaves, and annexation leaves long bays along the edge. A street in a hole is not in the
build, so Explore would skip it mid-neighbourhood. Fill the holes and close bays under ~500 m wide (a 250 m
buffer-out, buffer-in), cut off outlying pieces nobody would walk to as part of the town, and pass the result as
`--boundary-file`. Say so in `--regions-source`, since the deployment then differs from the legal limits.

**Pick a method.** Two ways from zones to regions:

- `--method blocks` (the default) cuts the city into blocks along the streets, so borders follow the street
  pattern wherever it goes. Use it when borders must follow curving or irregular roads (Evansdale).
- `--method zones` takes each zone, clipped to the city, as its region, and gives each divide road a strip on its
  owning side. Use it when the zones' edges already lie on the arterials, as on a section-line grid (most of the US
  West and Midwest), or when blocks report many problems. Faces that span several zones defeat blocks: a city edge
  full of holes and bays splits a region into parts, and blocks hand all but the largest part, streets and all, to
  a neighbour. Kuna's first blocks run reported 163 problems; zones reported none. Draw the zone edges on the
  arterials' lines; `--dividers` has no role here (draw the line as a zone edge instead).

**Inputs**, under `db/onboarding/<city-id>/inputs/draw_regions/` (git-ignored, kept with the city's other inputs):

- `zones.geojson`: one polygon per region with a `name` column (polygons sharing a name make one region), drawn in
  QGIS over the first build's `qgis_road` layer, or written by a script from the arterials' coordinates (Kuna's
  `make_inputs.py`). With blocks, precision is
  wasted: the zones only decide which region each street belongs to (by its midpoint), and the borders are redrawn
  from the streets. With zones, the edges are the borders, so they must meet without gaps or overlaps; the tool
  densifies them before reprojecting, so edges drawn as lon/lat corners kilometres apart still meet.
- `dividers.geojson` (optional): lines that separate regions where no included street does. A freeway is the usual
  one: motorways are filtered out of the build, so without its line the blocks either side of it merge into one
  face. Also the line of a border road carried on across open ground to the city edge.
- The flags: one `--divide-road "<OSM name>:<north|south|east|west>"` per arterial, one
  `--landmark "<region>=<lon>,<lat>"` per landmark-named region.

**Run it** on a build made *without* drawn regions (the first one), whose GeoPackage carries the OSM street names
on its `osm_way` layer. A build with drawn regions has cut its streets at their borders, so drawing again from it
weighs the blocks differently: Evansdale's Bunger Middle School block moved to Northeast that way.

```
make draw-regions id=evansdale-ia args="--zones db/onboarding/evansdale-ia/inputs/draw_regions/zones.geojson \
    --dividers db/onboarding/evansdale-ia/inputs/draw_regions/dividers.geojson \
    --divide-road 'Gilbert Drive:south' --landmark 'Bunger=-92.2747,42.4716'"
make draw-regions id=kuna-id args="--method zones --probe-m 120 \
    --zones db/onboarding/kuna-id/inputs/draw_regions/zones.geojson \
    $(cat db/onboarding/kuna-id/inputs/draw_regions/args.txt)"
make build-city-data id=evansdale-ia args="--place 'Evansdale, Iowa, USA' \
    --regions-file db/onboarding/evansdale-ia/regions_drawn.geojson \
    --regions-source 'Drawn for Project Sidewalk: <town> has no official neighbourhoods; \
    regions are blocks bordered by <roads>'"
```

With blocks it assigns each street a region, cuts the city into blocks along the streets, the city edge and the
dividers, gives each block to the region owning most of the side-street length around it, and lets each street
claim a 15 m strip (`--strip-m`) for its region. So every border runs alongside a road, 15 m off it, on the side away
from the road's own region. With zones only the divide roads claim strips, and each street then takes the region
holding most of its length. Keep the strip at 15 m: Kuna tried 25, which swallowed frontage streets running beside
an arterial. A divide road's owner is the zone `--probe-m` metres to its owning side (default 30); it must reach past
the road's offset from the zone edge, so an arterial that wanders off its line needs more (Kuna used 120).

Paths are from the repository root, where the make target runs; `args.txt` holds the `--divide-road` and
`--landmark` flags, so the method and probe go on the command line. A divide road must be a street in the build: one
that lies wholly outside the boundary is refused by name.

It prints the street count and km per region and writes `regions_drawn.geojson`, or
`regions_drawn.rejected.geojson` and a list of problems when a check fails (each run first deletes both, so a file
from an earlier run is never left to build with). With zones it also prints, per divide road, the km of strip each
region got, the stretches that kept none (the probe left every zone, or reached a zone with no city ground nearby,
across a bay or enclave), and the stretches that run through the middle of one zone: right where the road runs on
past the end of a border, a sign to raise `--probe-m` where a border lies farther off the road than the probe.

- the regions leave a gap inside the city, reach outside it, or overlap, by more than snapping noise (a piece wider
  than 0.5 m);
- a region has a piece cut off from the rest, under the 1 ha the build keeps as a part of its own, so the build would
  hand it to a neighbour (with zones, the tool hands such pieces over itself, as the build would);
- a street leaves its region for 30 m or more, so the build would cut that stretch into a street of its own (a
  zone edge or divider crosses the street; move it);
- a named street switches region and back again (give it a `--divide-road` side, or redraw the zones);
- a landmark is not in the region named after it, or a region holds no street.

**What not to do.** Tiling the city by the nearest street (a Voronoi diagram of street points, then smoothed) was
tried first for Evansdale and abandoned. Its borders zigzag between the ends of side streets, two regions' streets
meeting at a junction leave thin wedges, and simplifying the polygons cannot remove either without moving streets
between regions. Blocks have none of these problems, because a block's edges are streets already.

Two worked examples, each with `args.txt` holding its flags:

- **Evansdale, IA** (`db/onboarding/evansdale-ia/inputs/draw_regions/`, blocks): nine regions on Lafayette Road,
  Central Avenue, Evans Road, Gilbert Drive, US-20 and McCoy Road.
- **Kuna, ID** (`db/onboarding/kuna-id/inputs/draw_regions/`, zones, `--probe-m 120`): eleven regions of 18–42 km
  on the mile-section arterials (Black Cat, Ten Mile, Linder, Meridian; Columbia, Hubbard, Deer Flat, Avalon/Kuna
  Road, King) plus a Downtown on both sides of Main Street, from a boundary with its enclaves and bays filled
  (`make_boundary.py`, one level up). What it taught:
  - *An arterial with a gap in OSM.* Deer Flat Road is missing west of Ten Mile, so nothing marks the border there;
    the zones carry a local notch so a subdivision's stub street stays with its subdivision.
  - *An arterial off its section line.* East Kuna Road runs 70 m south of the line its zones meet on, so a 30 m
    probe landed in the wrong zone; `--probe-m 120` reaches past it.
  - *A road that changes name along its line* (Avalon Street becomes Kuna Road) needs a `--divide-road` per name,
    and a road with a `North`/`South` or `East`/`West` prefix is two names.
  - *A rail line or diagonal road* (Shortline Street) cuts a triangle no grid zone matches; give it to one side
    with a zone edge along it.

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

`tools/city/setup_new_city.py` is host-side and stdlib-only; it edits repo files and drives the two containers. It pauses
where a person is needed and skips whatever a previous run already did. **Run it from the checkout the containers
were started from** — they mount that checkout's `db/` at `/opt` and the whole tree at `/home`, and every db step
reads that copy, so from a git worktree or a second clone the script would check its own artifacts and evolutions
while the steps used the other checkout's. It checks by hashing the file each step is about to use against the
container's copy and refuses on a mismatch; `--dry-run`, which only previews edits to the checkout's own `conf/`
files and drives no container, is the one mode allowed anywhere.

Unattended (CI, a scripted rebuild, an agent), pass `--yes`: every question takes its default, the review of the
build report included, and `--donor`, `--country`, `--pano-type`, `--tutorial-region` and `--regions` set the
answers that have no sensible default (a non-US city has no default country; a wrong `--regions`/`--tutorial-region`
pair is refused up front rather than re-asked). `--recreate` is the "yes" to "drop and recreate?", the one answer a
rerun cannot take unattended otherwise. Without `--yes`, a run with nothing on stdin stops at the first question
that is a choice rather than letting it fall to nobody; only the cautious question (keep an existing schema) takes
its default either way.

0. **Review** — prints the report's headline numbers and the preflight table, asks to continue.
1. **Configs** — asks for the display name, country/state, provider, status (default `private`), launch date (the
   Friday of next week) and URLs, then registers the city in every per-city map of `conf/cityparams.conf` (GA ids
   empty — the layout skips the tag for an empty id), adds `city.name.<id>` (and a new state's or country's name) to
   `conf/messages/messages`, the state abbreviation to `messages.en`, the City IDs row to `docs/dev-environment.md`,
   and prints the translation keys you still owe. The false-by-default flags (`private-profiles-by-default`,
   `global-leaderboard-excluded`, `ai-label-submission-enabled`) are left unset. A city in a new country also needs
   a decision on `news-email-opt-out-countries` in `conf/application.conf` (#5864): list the country only if its
   email law lets a newsletter go out without prior consent, since that is what pre-checks the sign-up form's
   project-news box.
2. **Google Analytics** — with `ga-service-account.json` in the repo root (one-time setup in
   `tools/city/create_ga_properties.py`), creates the prod and test properties inside the existing GA accounts and fills
   both the `G-…` measurement ids and the numeric property ids. Skipped with a pointer otherwise; run the script
   standalone later. Then it asks to add both URLs' hostnames to the production Maps key's referrers
   (`tools/city/maps_key_referrers.py`, which only ever appends); without them the city's map and panos don't load. It
   needs `gcloud` signed in as an identity that can edit the key, and when gcloud can't read or edit it, the step is
   skipped with a pointer.
3. **Schema** — `db/scripts/create-new-schema.sh` clones a **donor** city's structure and seed rows (evolutions,
   version history, `config` with its tutorial street, tags, survey questions), creates the role, bumps the
   sequences, grants `readonly_user`. The SidewalkAI user's per-schema rows are not among the seeds: the clone
   marks 281.sql (which seeded them) applied, so the app inserts them itself at boot — the step 4 boot here, and
   the server's first boot after the dump is restored (`AiSeedRowsRepair`, #5349). The donor defaults to the dev
   container's `DATABASE_USER`; pass `--donor` to choose. A donor is refused below evolution 373 (its `label_type`
   is still a table that `tag` references, so the seed copy fails half-way; such a schema is usually stranded below
   372 too, which no boot can fix — see `docs/dev-environment.md`) and when it has applied an evolution beyond this
   checkout's highest — a dev schema that hosted another branch's QA, which would otherwise carry that branch's
   evolution into the new city. The same
   schema can also hold another branch's evolution under the *same* number, so the donor's top evolution is
   checked too: it passes when its `play_evolutions` hash is the one Play computes from this checkout's file
   (`make` and the orchestrator pass it in); otherwise every other city schema that has applied that number must
   agree with the donor, and a disagreement names the schemas so you can pick another `--donor`. (The committed
   `sidewalk_init` template is not used here: it is frozen at evolution 252 and cannot be replayed past 372, #5198.)
4. **Evolutions** — boots the app once as the new city and waits for `play_evolutions` to reach the repo's highest.
   Right after a clone it boots even when the donor was current, because Play is the one reliable check that every
   applied evolution is this checkout's (it compares hashes and, with `autoApplyDowns`, reverts and re-applies from a
   mismatch). A schema kept from a run that stopped before the fill is verified the same way, since its hashes were
   never checked either; a kept schema that already holds streets skips the boot. The boot listens on its own port
   (`:9100`, which compose does not publish), so `npm start` and any `make qa-worktree` stay up. What it cannot
   share is the checkout it compiles: two builds in one `target/` corrupt it, so the step asks the web container
   (from inside it — Docker's port forwarder on the host accepts a connection whether or not anything listens
   behind it) what is building in `/home` and waits for you to stop it. A worktree's own build is not in the way:
   only `target/` is per-checkout, the caches under `/home/.sbt` and `/home/.coursier` are shared by design.
   Without a terminal to ask, it stops and names what is in the way; `--allow-running-apps` boots past a build in
   the main checkout you know is idle (the boot passes `sbt.server.forcestart`, without which sbt exits at once when
   another server owns the checkout), never past a boot an earlier run left behind. The boot runs on CI's
   `application.ci.conf`, with the nightly actors switched off, so a boot that straddles one of their scheduled
   minutes cannot write job rows into the new schema.
5. **Load** — `qgis_tables.sql` into the schema.
6. **Fill** — `fill-new-schema.sh` with the tutorial region and which regions open at launch (`all`,
   `include:1 2 3`, `exclude:4`; or `--tutorial-region` and `--regions`). The tutorial region has to be among the
   open ones, and the script checks the pair before running the fill. It sets the city center, map bounds (region
   extent + 0.5°), and default zoom from the open regions, and prints what landed: streets, km, sub-20 m share,
   per-region km, open/closed regions. The fill is one transaction: a failure leaves the unfilled clone, and a rerun
   comes straight back to this step.
7. **Imagery scan** — exports the endpoints from the database, runs `check_streets_for_imagery.py` for the city's
   provider (resumable; an hour or so for a mid-sized city), hides the no-imagery streets, and imports the imagery-age
   summary into `street_imagery`. `--skip-scan` defers it; a rerun picks it up. A partner's area that cuts across
   regions (Beringen, #5950) goes in as `--study-area <geojson under db/>`: open the regions it touches, and after
   the scan their streets outside it become `disabled`, which no rescan, reveal or Reopen undoes. To grow the area,
   rerun `make disable-streets-outside-area` with a larger one; it puts those streets back as they were.
8. **Street gradient** — exports the streets with the build's `street_structures.csv` standing in for the `osm_way`
   cache, samples the elevation model registered for the city's country (`tools/city/street_gradient.py`, seconds for
   most cities), and imports the result into `street_gradient`, so the grades ride into prod inside the dump
   ([`street-gradient.md`](street-gradient.md)). A country with no registered model (every one but the USA today)
   gets the hand-download recipe printed and the run goes on; once the rasters are downloaded, rerun with
   `args="--dem-dir … --dem-name … --dem-resolution-m …"` (the sampler's own flags), or backfill the live city. A
   build without `street_structures.csv` skips the step too. `--skip-gradient` defers it; a rerun picks it up.
9. **Dump** — `pg_dump -Fc` of the finished schema to `db/<schema>-dump`, the file `make import-dump` and the
   server both restore, with the data of every table the clone, the fill, the scan and the gradient do not write left out
   (`--exclude-table-data`, from the schema's own catalog, with those tables' sequences), `region_completion`
   included since the app recomputes it from an empty table. A local QA pass (one walk in Explore leaves an
   `audit_task`, thousands of `audit_task_interaction` rows, a moved `audited_distance`) and a job run as the city
   (`intersection`, `cluster`, `sidewalk_presence`, `background_job_run`, …) both stay in the local schema and out
   of the dump; the step prints what it left out. The one value it has to touch is `street_edge_priority`, which a
   QA walk moves off the fill's 1 in a table the dump keeps: it offers to reset them (default yes; `--yes` takes
   it). Then the handoff checklist. `--dump-only` runs this step alone, and refuses a schema that is still the
   unfilled clone.

## 4. What stays on a person

- **Translations.** Every `conf/messages/messages.<lang>` gets a line for the city (and any new state or country):
  `zh-TW` transliterated, `es`, `nl`, `de`, `pt-BR`, `fr` with the exonym where one exists (`Nueva York`,
  `États-Unis`) and the English spelling where the name reads the same. The line goes in even when it equals the
  English, so that a missing line always means "not looked at yet" and the orchestrator can list exactly what is
  owed (`docs/internationalization.md`). `make lint-locales` must stay green.
- **The `config` row.** The clone carries the donor's `excluded_tags` (a European city may want a different set),
  `update_offset_hours` (overnight for the city, on the slot the fewest prod cities share; the `onboard-city`
  skill has the recipe), and `make_crops`; the fill prints all three and clears the donor's `mapathon_event_link`
  and official contact. If the city's government wants residents pointed to its own contact page (#5462), set it
  on `/admin/partners` after launch. Check them before launch.
- **Visual QA.** Land on the site as the new city (`SIDEWALK_CITY_ID` + `DATABASE_USER` in
  `docker-compose.override.yml`, recreate the container): the map centers on the city, neighborhood names read right,
  one street walks in Explore on the chosen imagery, the Explore tag lists match `excluded_tags`. Two things the
  first visit needs: sign in **before** switching the dev env to the new city — from a dev env pointed at an existing
  city — so that whatever your testing logs is attributed to a user that already exists in the production
  `sidewalk_login`; and if the landing map needs a different zoom, edit `config.default_map_zoom` and clear the Play
  cache from the admin page (it caches the config row), the same after hiding streets on a live server, since the
  total street distance behind the completion percentage is cached too.
- **The minimap basemap needs nothing.** A new city cuts its own tiles within an hour of first starting (#5716).
- **What the nightly jobs still owe.** Onboarding fills only what no scheduled job can produce, so a new city's
  `intersection` table (with each street's corner links, #5095), its `cluster` table, its `sidewalk_presence`
  table, its `place` table (the schools, clinics, and transit stops the AccessScore map shows, fetched from
  OpenStreetMap on the first nightly tick or from Admin > Management > "Refresh places", #5311), and its `osm_way`
  tag cache are all empty — in the dump you hand the server, too — until each job's first
  nightly run (`app/actor/ScheduledJobs.scala`, shifted by the city's `update_offset_hours`). AccessScore reads
  zero until then. An admin can force the intersections and clusters early from `/clustering` — on the launched
  site; a local run's rows stay local, since the dump leaves those tables' data out. The `osm_way` tags come from
  their own nightly refresh, and until they land every intersection is `grade_separated = FALSE`; deriving the
  cache during onboarding would not help there, since the intersections are rebuilt nightly anyway (#5297). The
  one consumer that cannot wait a night, the street-gradient export, takes its bridge/tunnel flags from the build's
  `street_structures.csv` instead, which is why `street_gradient` is filled at onboarding and does ride in the dump.
- **The pano scraper.** Add `<city-id>,<prod fqdn>` to `/etc/sidewalk/cities.csv` on the scraper host
  ([`sidewalk-panorama-tools`](https://github.com/ProjectSidewalk/sidewalk-panorama-tools)). The nightly queue picks
  it up that evening; `scrape_queue.py --only <city-id>` pulls the panos now.
- **Server.** `scp db/<schema>-dump <netid>@makelab1.cs.washington.edu:/www/sidewalk/new-city-dumps/<schema>-empty-dump`
  — the destination follows the convention every file in that directory uses, while the local name stays
  `<schema>-dump`, which is what `make import-dump` restores and what a populated prod pull is called too. (An ssh
  alias that sets the user works as well; a bare hostname without one fails with `Permission denied`.) **If you
  QA'd the city locally, dump it again first**: `make onboard-city id=<city-id> args="--dump-only"` reruns only the
  dump step. The QA data stays in your local schema and out of the dump; the one thing the step changes is the
  street priorities a walk moved, which it resets to the fill's 1 on a `y`. Then the IT tooling
  (`uwcseit-sidewalk-tools`: `bin/setup-new.pl`, test stage first), the Maps-key referrers for both URLs if step 2
  skipped them (`python3 tools/city/maps_key_referrers.py <city-id>`), DNS, and the PR with the config, message, and docs
  changes. Where the tooling can't be used, the fallback is an email to CS support asking for the test and prod
  servers, with both URLs, any redirect from an older name, `SIDEWALK_CITY_ID`, and `DATABASE_USER`.

## Optional follow-ups

- **Uptime monitoring.** In [Uptime Robot](https://uptimerobot.com/), add an HTTP(s) monitor at a 5-minute interval
  on the `/signIn` endpoint of each stage (e.g. `https://sidewalk-<city>-test.cs.washington.edu/signIn`).

## Re-running, and doing it by hand

Every step is idempotent: `make onboard-city` skips a registered city, an existing schema (unless you say drop, or
pass `--recreate`), applied evolutions, a filled schema, and an imported scan. `args="--dump-only"` goes straight
to the dump step, so a city that was QA'd after its first dump never has to pass the "drop and recreate?" question
again. To redo the
streets after launch, the wiki's "Adding new road geometries" flow still applies — this tooling is for the first
import.

The equivalent manual sequence, for a hand-made QGIS export or a partial rerun:

```
make create-new-schema name=sidewalk_<city> donor=sidewalk_<donor>
docker exec -i projectsidewalk-db psql -v ON_ERROR_STOP=1 -U sidewalk_<city> -d sidewalk -f /opt/onboarding/<city-id>/qgis_tables.sql
make fill-new-schema                      # schema, tutorial region, regions to open
make check-imagery id=<city-id> args="--<provider>"
make hide-streets-without-imagery         # schema, onboarding/<city-id>/street_imagery_summary.csv
make disable-streets-outside-area         # only for a study area: schema, onboarding/<city-id>/<area>.geojson
make import-street-imagery                # schema, onboarding/<city-id>/street_imagery_summary.csv
make export-street-gradient-input args="sidewalk_<city> <city-id> --structures onboarding/<city-id>/street_structures.csv"
make street-gradient id=<city-id>         # or args="--dem-dir ..." for a country with no registered model
make import-street-gradient args="sidewalk_<city> onboarding/<city-id>/street_gradient.csv"
```

A hand-built `qgis_road` needs the canonical columns (`osm_ids = ARRAY[osm_id]`); `--from-gpkg` accepts a layer with
a single `osm_id` column and converts it.
