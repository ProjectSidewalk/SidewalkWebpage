# Street gradient

Every street gets a running slope, a climb and an elevation profile, sampled along its centerline from a bare-earth
elevation model (#5223). It needs no labeling, so it exists for unaudited streets too. The numbers live in the
`street_gradient` table (398.sql), filled offline by [`scripts/street_gradient.py`](../scripts/street_gradient.py).
The app reads it and never writes it ([Where it shows up](#where-it-shows-up)). Slope can be weighed into the
AccessScore, at an engine weight of 0 ([Slope in the score](#slope-in-the-score)).

## Filling or topping up a city

Three commands, from the main checkout (the db container sees only that checkout's `db/`). The sampler needs
rasterio, which arrives with `requirements-offline-tools.txt`, so a web image built before #5223 has to be rebuilt
first (`make dev`):

```bash
make export-street-gradient-input         # prompts: schema, city id -> db/onboarding/<city-id>/street_gradient_input.csv
make street-gradient id=<city-id>         # -> db/onboarding/<city-id>/street_gradient.csv
make import-street-gradient               # prompts: schema, CSV path -> upsert into street_gradient
```

The import loads a row only while its `geom_md5` still matches the street, and aborts when none of the file does, or
less than half of a file of 20 rows or more, which is what a CSV pointed at the wrong city's schema looks like
(`street_edge_id` is a per-city serial). A smaller top-up just reports the rows it skipped.

The export holds only streets with no row yet or whose geometry changed since they were sampled (`geom_md5`), so
after a street import the same three commands top the table up. `make export-street-gradient-input args=--all`
resamples everything, which is what a change to the method itself calls for. Seattle's 27,645 streets take about 13
seconds; the sampler flushes a grid cell at a time, and `--resume` continues an interrupted run. It keeps only the
rows that answer the current export (same street, same `geom_md5`), so a leftover CSV from an earlier fill never
stands in for a street whose geometry has changed since.

Run the export after the city's first nightly OSM way refresh. Which streets are bridges or tunnels comes from
`osm_way.tags`, and with an empty `osm_way` every bridge would be sampled as the ravine beneath it without anything
downstream noticing, so the export refuses to run against one. `args=--allow-empty-osm-way` overrides that for a
city that really has none.

A city whose country has no registered source (every country but the USA today) is sampled from rasters someone
downloaded by hand:

```bash
make street-gradient id=cdmx args="--dem-dir db/onboarding/cdmx/dem --dem-name inegi-mdt-5m --dem-resolution-m 5"
```

Any set of GeoTIFFs works, in any mix of coordinate systems, as long as elevations are in meters and the model is
bare-earth. `--dem-name` is stored as `dem_source`, which is what attribution will be keyed on, so name the product
and not the file.

## What is stored

Grades are fractions: 0.05 is a 5% grade, the OpenSidewalks `incline` convention.

| Column | Meaning |
|---|---|
| `net_grade` | End-to-end grade, signed in the street's digitized direction. |
| `mean_grade` | Mean absolute grade over every 10 m baseline. |
| `max_grade` | Steepest absolute grade over any 30 m baseline (any 10 m baseline on a street under 30 m), never below `mean_grade`. |
| `max_grade_from_m`, `max_grade_to_m` | Where that baseline lies, in meters from the first vertex. Located on the full-resolution samples, since `profile_cm` is too coarse to reproduce `max_grade`. NULL on a `suspect` row's straight line and where `max_grade` was floored at `mean_grade`: no one stretch set it. |
| `meters_over_5pct_grade`, `meters_over_8pct_grade` | Length of street whose 10 m baselines exceed the ADA / PROWAG walking-surface limit (1:20, 5%) and ramp limit (1:12, which is 8.33%; the column is named for the round figure). |
| `climb_m`, `descent_m` | Summed rise and fall in the digitized direction, over 10 m steps so sample noise does not accumulate. |
| `elev_start_m`, `elev_end_m` | Elevation at the first and last vertex. Streets meeting at a node sample the same point, so they agree wherever the model has data at the node. |
| `profile_cm` | Elevations in whole centimeters at even spacing, endpoints included, about every 10 m. Spacing is the street's length over `array_length - 1`. |
| `quality` | `measured`, `structure`, `suspect`, or `no_data` (below). |
| `confidence` | `high` for a model at 10 m or finer, `medium` to 20 m, `low` beyond. Pinned to `dem_resolution_m` by a CHECK. |
| `dem_source`, `dem_resolution_m` | Which model, for attribution and for upgrading a city's source later. |
| `geom_md5` | `md5(ST_AsBinary(geom))` when sampled, for the staleness test. |

`max_grade` uses a 30 m baseline because the maximum of a noisy series is biased upward: against lidar, a 10 m maximum
carried 3 to 4 times the error of the mean, a 30 m one about half of that. A street under 30 m (16% of Seattle's) has
no such baseline, and its end-to-end grade would only repeat `net_grade`, so it takes its steepest 10 m pitch. Against
the lidar's own steepest 10 m pitch on those streets that is off by 1.0 to 1.1 pp with no bias, where the end-to-end
grade was off by 1.3 to 1.6 pp and read 0.9 to 1.2 pp low.

The street centerline is the right thing to sample. PROWAG R302.4.1 caps a pedestrian access route at 5% *except*
where the adjacent street is steeper, in which case the sidewalk may match the street, so street grade is the number
the standard itself points to, and it is what a bare-earth model resolves best. Cross slope is not recoverable from a
centerline sample.

### What a bare-earth model cannot see

It removes bridges and knows nothing of tunnels, so a street on a structure samples the ravine or the hill, not the
deck: in the study windows the 1 to 4% of streets tagged as structures showed a median "max grade" of 40 to 48%.

- **`structure`**: the street's OSM way is tagged `bridge`, `tunnel` or `covered`. It has `elev_start_m` and
  `elev_end_m` and every grade statistic NULL. Not even a straight line between the two ends holds up: a bridge's
  ends sit at the lip of what it crosses, where a 10 m model already reads partway down. Drawn that way, 58 of
  Teaneck's 60 tagged streets averaged a 10% grade (the other two came out over 40%), 27 of them over the 8.33% ramp
  limit, and the level Route 4 overpasses (Margaret Street, Cedar Lane, Grayson Place) read 20 to 37%. The elevations
  are kept so that a later pass can anchor a whole bridge on solid ground set back from its abutments.
- **`suspect`**: the sampled profile holds a 10 m pitch over 20% that is also more than three times the street's
  end-to-end grade, on a street with no structure tag. Its statistics come from a straight line between its endpoint
  elevations instead of its samples. This catches what tags miss, such as a lid over
  a freeway or a street whose `osm_way_street_edge` row names a different way of the same road, and it leaves a
  uniformly steep hill alone, since there the pitch and the end-to-end grade agree. A pitch over 40% is suspect
  whatever the end-to-end grade, since no street anywhere is that steep (Canton Avenue and Baldwin Street are 35 to
  37%). And when the end-to-end grade is itself over 40%, the endpoints are what is wrong (a 10 m stub with one end on
  each side of a retaining wall: 24 of Seattle's 27,645 streets), so the row is `suspect` with every statistic and
  both elevations NULL. Together the rules fired on 1.2% of Teaneck's untagged streets (26 of 2,112).
- **`no_data`**: the model has no data at either end of the street, or (unless it is a structure, which is read at
  its ends only) at more than half the samples along it. Every statistic is NULL. Gaps between the ends are bridged
  along the profile, which matters for models like AHN that blank every building and canal. A missing end is not
  bridged because there is nothing beyond it to bridge from, and every statistic is normalized by the whole length:
  holding the last known elevation out to the end reads the unseen stretch as level, which turned a 1% street missing
  a fifth of its length at each end into a 0.6% one.

The grade *of* a bridge deck is out of reach with any bare-earth model. Amsterdam's canal bridges are real barriers
that this table reports as level.

## Why these sources: the measurements

Measured 2026-09-19 on 3 to 5 km windows in eight cities, about 16,000 streets, each sampled every meter. Reference:
1 m lidar bare-earth (USGS 3DEP; IGN LiDAR HD for Bayonne; AHN for Amsterdam). Numbers are the mean absolute error of
`mean_grade` in percentage points of grade, with precision / recall of the "steeper than 5%" flag where shown.
Structures are excluded.

| City | USGS 3DEP 10 m | Ideal 30 m bare-earth | Copernicus GLO-30 (surface model) | GEDTM30 (global bare-earth) |
|---|---|---|---|---|
| Seattle | 0.27 (P .97 / R .97) | 0.69 | 3.90 (P .49) | 3.42 (P .52) |
| Pittsburgh | 0.59 (P .94 / R .95) | 1.08 | 3.51 (P .50) | 2.95 (P .56) |
| Teaneck | 0.48 (P .94 / R .84) | 0.36 | 4.05 (P .19) | 2.10 (P .36) |
| Newberg | 0.12 | 0.29 | 1.93 (P .11) | 1.75 (P .15) |
| Tucson | 0.08 | n/a | 1.43 (P .02) | n/a |
| Chicago (flat) | 0.15 | 0.26 | 3.73 | 2.54 |
| Bayonne | n/a | 0.74 | 3.38 (P .17) | 2.42 (P .25) |
| Amsterdam (flat) | n/a | 0.40 | 5.84 | 3.92 |

"Ideal 30 m" is the lidar block-averaged to 30 m, which isolates grid size from everything else. The same sweep at
other sizes (range across Seattle, Pittsburgh, Bayonne, Teaneck):

| Grid | `mean_grade` MAE (pp) | F1 of the ">5%" flag |
|---|---|---|
| 5 m | 0.05 to 0.10 | 0.98 to 0.99 |
| 10 m | 0.13 to 0.33 | 0.94 to 0.98 |
| 20 m | 0.26 to 0.79 | 0.79 to 0.95 |
| 30 m | 0.36 to 1.08 | 0.70 to 0.92 |

What follows from it:

- **Bare-earth matters far more than grid size.** A surface model includes buildings and tree canopy, so GLO-30 reads
  flat Amsterdam as a 6% grade. A source is only registered in the script if it is bare-earth.
- **US cities use USGS 3DEP 10 m (1/3 arc-second seamless), not 1 m.** Against 1 m lidar it costs 0.08 to 0.59 pp and
  holds the 5% flag near 0.95. It is one gap-free source for every US city, where 1 m project coverage is patchy and
  overlapping projects need per-tile date resolution, and it is about 100 times less data (Chicago's bounding box is
  ~54 GB at 1 m). `dem_source` is per row, so moving one city to 1 m later is incremental.
- **The `confidence` cut points are this sweep's**: 10 m and finer is `high`, to 20 m `medium`, coarser `low`.
- **A global 30 m model supports `net_grade` only.** End-to-end grade on streets of 80 m and longer, with the model
  smoothed first, came within 1.0 to 1.4 pp in hilly cities (r 0.72 to 0.86). The table allows such a row: the
  windowed statistics may be NULL while `net_grade` is set.

The production sampler reproduces the study. Run on all of Teaneck and compared on the 1,031 streets of the study
window, against the lidar reference: `mean_grade` MAE 0.18 pp, `max_grade` 0.29 pp on streets of 30 m and longer, the
5% flag at precision and recall 0.94, and the same 11 of 11 structures the study found from OSM tags. Run on all of
Seattle (27,645 streets, 13 seconds) and compared on the window's 3,138: `mean_grade` 0.32 pp, `max_grade` 0.37 pp,
the 5% flag at precision 0.98 and recall 0.96, with no measured street over 40%.

Caveats: windows, not whole cities; the reference is lidar, not a field survey; the 20 m and 30 m rows are idealized,
so a real photogrammetric 20 m model will do somewhat worse.

## Sources by country

`SOURCE_BY_COUNTRY` in the script maps a `cityparams.conf` `country-id` to its registered source. Only the USA is
registered so far. The rest of this table is the plan from #5223, so whoever adds the next adapter starts from a
tested endpoint instead of a search.

| Country | Model | Grid | Access |
|---|---|---|---|
| USA | USGS 3DEP 1/3 arc-second seamless | 10 m | **Registered.** Public COGs on `prd-tnm.s3.amazonaws.com`, one per degree tile. |
| Switzerland | swissALTI3D, or Canton Zürich DTM | 0.5 m, 0.25 m | STAC at `data.geo.admin.ch`; canton tiles at `maps.zh.ch/download/hoehen/`. |
| Netherlands | AHN DTM | 0.5 m | PDOK WCS `service.pdok.nl/rws/ahn/wcs/v1_0`, coverage `dtm_05m`. 66% no-data in central Amsterdam. |
| France | IGN LiDAR HD MNT | 0.5 m | Géoplateforme WMS-Raster `data.geopf.fr/wms-r` with `FORMAT=image/geotiff`. |
| New Zealand | LINZ regional lidar DEMs | 1 m | `s3://nz-elevation`. LERC-compressed, so check the GDAL build reads it. |
| Canada | NRCan HRDEM | 1 m | COGs on `canelevation-dem.s3.ca-central-1.amazonaws.com`, STAC at `datacube.services.geo.ca`. |
| Brazil (São Paulo) | GeoSampa lidar 2020 | point cloud | Ground-classified LAZ per tile, to be rasterized first. CC BY-SA 4.0. |
| Mexico | INEGI MDT | 5 m | Portal download only, no API: use `--dem-dir`. |
| Taiwan | MOI DTM | 20 m | Open data, but the host refuses non-Taiwan addresses: download there, then `--dem-dir`. |
| Chile, India, Ecuador | none open below 30 m | 30 m | GEDTM30 (CC BY 4.0), `net_grade` only, `confidence = low`. |

The test for a new country is the one used here: an open bare-earth model at 10 m or finer is `high`, to 20 m
`medium`, and otherwise the city gets `net_grade` from a global model.

## Where it shows up

**Terminology.** The English UI and the API say *grade* (*gradient* in the `en-NZ` overlay): a street's steepness
along its centerline. *Slope* is avoided because accessibility standards also use it for a sidewalk's cross slope,
which a centerline sample cannot measure; the tool's help text says so. Other languages keep their own word. Only
German's (*Steigung*) is specifically along-the-street; es, fr, pt-BR and zh-TW use a general word for slope, so there
the translated cross-slope sentence carries the distinction. Code identifiers (`AccessScoreSlopePanel`, `SlopeSettings`, the `slope-*` locale
keys, `#acs-slope-*`) keep the older word: renaming them would change nothing a reader or an API client sees.

`StreetGradientTable` is the read-only Slick model; nothing in the app writes the table.

- **`/v3/api/accessScoreStreets`** carries ten grade fields per street in every format (`mean_grade`, `max_grade`,
  `net_grade`, `total_climb_meters`, `total_descent_meters`, `meters_over_5pct`, `meters_over_8pct`,
  `grade_confidence`, `grade_quality`, `dem_source`), null on a street that has not been sampled. They are declared
  once, in `StreetGradientApiFields`. The statistics are read without `profile_cm`, so a city-wide request never
  pulls the arrays. The full-city cache holds them, so an import shows up within its ten-minute freshness window.
- **`/v3/api/streetGrade?streetEdgeId=`** serves one street's statistics and its profile, in meters at a
  stated spacing. A sampled street with no profile (a structure, a gap, a coarse-model row) answers 200 with
  `profile: null`; only a street with no row is a 404. `stale: true` marks a street whose geometry has changed since
  it was sampled (the export script's own `geom_md5` test, asked for one street): its numbers describe the old line
  until the next top-up. The city-wide payload does not carry the flag, since the hash is computed per row.
- **`/v3/api/accessScoreConfig`** publishes, under `grade`, the two limits (`StreetGradientStats`), the grades a
  slope map is classed at (`MapClassBreaks`: 1:48, 1:20, 1:12, 1:8), and the credit for each elevation model the
  city's rows came from. An empty `sources` is how a client knows the city has not been sampled.
- **The Street Grade API docs page** (`/v3/api-docs/streetGrade`) previews both endpoints on one map: a sample
  region's streets colored by `max_grade` in the tool's slope classes, and, on hover, the street's profile in the
  tool's own chart (click pins the popup so the chart can be used). The ramp and the chart live in `js/common/`
  and `css/components/elevation-profile.css` so the docs load the same code as the tool, not a copy of it.
- **The AccessScore tool** (`/accessScore`) gets an Options checkbox, "Color streets by grade", hidden in an
  unsampled city. It recolors the street lines through `AccessScoreGradeRamp` (classed, from the
  `--color-grade-ramp-*` tokens; every street with a grade is drawn at full strength, audited or not), swaps the map
  legend for the class list, and rides in the URL as `grade=1`. While it is on, "Show unaudited streets" is
  disabled, since grade is drawn for every street. The popup of a sampled street shows a Grade block: one line of
  steepest and mean grade, climb and drop, then the elevation profile (`AccessScoreElevationProfile`, fetched per
  street), and a sentence saying why when the numbers are missing (`structure`, `no_data`) or approximate
  (`suspect`, a coarse model). The profile colors each ~10 m stretch by the slope map's classes and brackets the
  stretch that set `max_grade` where `max_grade_from_meters` places it; its legend lists the length in each class,
  steepest first, recomputed from the same stretches the chart colors, so the two always agree (and can differ by a
  stretch from the stored `meters_over_5pct`, measured on the full-resolution samples). Legend rows are toggles that
  highlight their stretches on the chart, and pointing along the chart lights the row of the stretch under the
  pointer and states its grade and direction. To the keyboard and a screen reader the chart is a slider over the
  stretches, each announced by its `aria-valuetext`. A stale street's stretch is not bracketed, since it was placed
  along the old line. A street is drawn by its mean grade, or by the size of its `net_grade` where a coarse
  model supports nothing else (`AccessScoreModel.displayGrade`). Which statistic it draws follows the one the score is
using, so the map cannot paint a street gentle while the score penalizes it for a pitch the other statistic hid; the
legend names the statistic in its title. Each of the legend's classes is a button that brushes the map on it
(Ctrl-click to add more), through the same brush the dock's histogram sets, so only one of the two is ever in force.

## Slope in the score

Slope does not fit the AccessScore's per-label-type sum (it is not a label type, and `sub_scores` stays keyed by
label type), so it joins a segment's pre-sigmoid sum as its own **modifier term**: `logit(segment_score) =
Σ sub_scores + grade_term`. `AccessScoreCalculator` owns it (`SlopeSettings`, `slopeUnits`, `slopeTerm`,
`slopeIsBarrier`, `segmentScoreWithSlope`), and `AccessScoreModel.js` mirrors it, both held to the `slope_cases` of
`test/fixtures/accessScoreParity.json`.

- **The engine's weight is 1 on the steepest stretch** (`defaultSlopeSettings`), so a street whose worst 30 m is at
  or over the ramp limit loses exactly what one missing curb ramp or one severe obstacle costs it. `max_grade` over
  `mean_grade` because the worst pitch is what turns a traveler back, and an average hides the otherwise flat block
  with one brutal pitch in it.
- **A sampled city therefore scores below an unsampled one**, since a street with no gradient row takes no term at
  all. The gap closes as cities are imported; until then it is a reason not to rank two cities against each other,
  which these scores never supported anyway. The same follows for the nightly Spotlight snapshot (#5215): a sampled
  city's series steps down on the first run after the release that raised the weight.
- `grade_term = −weight × units`, never positive. Under **mean grade** or **max grade**, `units` ramps from 0 at the
  low threshold (default 5%) to 1 at the high one (8.33%). Under **meters over the limits**, `units` is the share of
  the street over 5% plus the share over 8.33%, halved. That statistic ignores the thresholds: the two lengths are
  measured against the fixed limits when the street is sampled, and recomputing them for other thresholds would put
  every street's profile in the city-wide payload.
- The thresholds are settings, not constants, because people's limits differ (AccessMap offers 8%/10% and 10%/12%
  profiles for manual and power wheelchairs).
- **Barrier** (off by default): a street whose `max_grade` exceeds the barrier threshold has a **segment** score of
  0 outright. Its headline still averages that 0 with the crossings at its ends, which is why the tool's popup says
  "the segment scores 0" under a headline that may not be. The default grade is 1:8 (12.5%), not the ramp limit:
  `max_grade` is a street's steepest 30 m, and 8.33% there is an ordinary block in a hilly city. 12.5% is also where
  the slope map's steepest class begins, so the barrier zeroes the streets the map already paints as its worst.
- **Approximate grades sit out** unless admitted (`include_approximate`). Two kinds of row are approximate, and for
  the same reason, that their grade is a straight line between the street's ends: a `low`-confidence row from a
  coarse model, which has `net_grade` alone and stands in `|net_grade|` for the grade it lacks; and a `suspect` row,
  whose `mean_grade` and `max_grade` the sampler set to that line because it distrusted the profile it read. Neither
  says anything of the pitches along the street, which is what the thresholds and the barrier are about. A street
  with no grade (`structure`, `no_data`, unsampled) never takes a term.
- **Crossed thresholds** (high at or under low) leave no ramp, and the engine reads the low one as a step. The
  tool refuses them, in the section and from a link, since both of its threshold labels would then be false.
- **An unaudited street stays unscored.** Slope modifies a score that labels produced; it never creates one, so the
  headline keeps meaning "assessed by people". Such a street still shows its slope on the grade layer and in its
  popup.

Raising the weight changes every served score, so `AccessScoreService`'s full-city cache key carries a version
(`accessScore:full-city:v4`) that is bumped whenever the engine's numbers move and not only when its shape does: a
cached value from the release before is well-formed and wrong, and nothing else would evict it.

`/v3/api/accessScoreConfig` publishes the settings under `grade_scoring` (`defaults`, the statistic ids, and the ranges a
weight and a threshold may take), and `/v3/api/accessScoreStreets` publishes each street's `grade_term`. The tool's
**Street grade** sidebar section (`AccessScoreSlopePanel.js`) edits them, hidden in an unsampled city; the settings
ride in the URL as `gs=`, the street popup's "What drives this score" table gains a Grade row once grade is
weighed in, and its Grade block says when a barrier has zeroed the segment.

## Attribution

Most of these models are attribution-only (public domain, CC0, CC BY, or a national open licence), and INEGI also asks
that a transformation be disclosed. `dem_source` on every row is what makes that answerable per street.

`DemSource` (app/models/street) holds the credit line, licence, publisher page and the publisher's own suggested
citation (verbatim, or none; never one we compose) for each model, and is the one place they are written. It is
shown in five places: the credits table (`apiDocs/elevationCredits.scala.html`) on the `accessScoreStreets` and
`streetGrade` api-docs pages, `grade.sources` on `accessScoreConfig`, the `attribution` object of a `streetGrade`
response, and the attribution line of both the AccessScore tool's map and the Street Grade docs preview (it rides on
the street source, so a basemap swap cannot drop it), plus under the tool popup's Grade block. **A new adapter in the script needs a
`DemSource` entry**: `test_street_gradient.py` fails until every `REMOTE_SOURCES` name has one. A city sampled with
`--dem-dir --dem-name` from a model nobody has registered is credited by that bare name, so register it too.
