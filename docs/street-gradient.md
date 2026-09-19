# Street gradient

Every street gets a running slope, a climb and an elevation profile, sampled along its centerline from a bare-earth
elevation model (#5223). It needs no labeling, so it exists for unaudited streets too. The numbers live in the
`street_gradient` table (398.sql), filled offline by [`scripts/street_gradient.py`](../scripts/street_gradient.py).
Nothing in the app reads the table yet: the API fields, the AccessScore tool layer and the scoring term are later
phases of #5223.

## Filling or topping up a city

Three commands, from the main checkout (the db container sees only that checkout's `db/`):

```bash
make export-street-gradient-input         # prompts: schema, city id -> db/onboarding/<city-id>/street_gradient_input.csv
make street-gradient id=<city-id>         # -> db/onboarding/<city-id>/street_gradient.csv
make import-street-gradient               # prompts: schema, CSV path -> upsert into street_gradient
```

The export holds only streets with no row yet or whose geometry changed since they were sampled (`geom_md5`), so
after a street import the same three commands top the table up. Pass `all` as the export script's third argument to
resample everything, which is what a change to the method itself calls for. Seattle's 27,645 streets take about 13
seconds; the sampler flushes a grid cell at a time, and `--resume` continues an interrupted run.

Run the export after the city's first nightly OSM way refresh. Which streets are bridges or tunnels comes from
`osm_way.tags`, and a new city's `osm_way` table is empty until that job has run.

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
| `max_grade` | Steepest absolute grade over any 30 m baseline (the whole street when it is shorter), never below `mean_grade`. |
| `meters_over_5pct`, `meters_over_8pct` | Length of street whose 10 m baselines exceed 5% and 8.33% (ADA / PROWAG walking surface and ramp limits). |
| `climb_m`, `descent_m` | Summed rise and fall in the digitized direction, over 10 m steps so sample noise does not accumulate. |
| `elev_start_m`, `elev_end_m` | Elevation at the first and last vertex. Streets meeting at a node sample the same point, so they agree. |
| `profile_cm` | Elevations in whole centimeters at even spacing, endpoints included, about every 10 m. Spacing is the street's length over `array_length - 1`. |
| `quality` | `measured`, `structure_interpolated`, `suspect`, or `no_data` (below). |
| `confidence` | `high` for a model at 10 m or finer, `medium` to 20 m, `low` beyond. Pinned to `dem_resolution_m` by a CHECK. |
| `dem_source`, `dem_resolution_m` | Which model, for attribution and for upgrading a city's source later. |
| `geom_md5` | `md5(ST_AsBinary(geom))` when sampled, for the staleness test. |

`max_grade` uses a 30 m baseline because the maximum of a noisy series is biased upward: against lidar, a 10 m maximum
carried 3 to 4 times the error of the mean, a 30 m one about half of that.

The street centerline is the right thing to sample. PROWAG R302.4.1 caps a pedestrian access route at 5% *except*
where the adjacent street is steeper, in which case the sidewalk may match the street, so street grade is the number
the standard itself points to, and it is what a bare-earth model resolves best. Cross slope is not recoverable from a
centerline sample.

### What a bare-earth model cannot see

It removes bridges and knows nothing of tunnels, so a street on a structure samples the ravine or the hill, not the
deck: in the study windows the 1 to 4% of streets tagged as structures showed a median "max grade" of 40 to 48%.

- **`structure_interpolated`**: the street's OSM way is tagged `bridge`, `tunnel` or `covered`. Its profile is a
  straight line between its endpoint elevations.
- **`suspect`**: no tag, but the sampled profile holds a 10 m pitch over 20% that is also more than three times the
  street's end-to-end grade (floored at 2%). Same treatment. This catches what tags miss, such as a lid over a freeway
  or a street whose `osm_way_street_edge` row names a different way of the same road, and it leaves a uniformly steep
  hill alone, since there the pitch and the end-to-end grade agree. A pitch over 40% is suspect whatever the
  end-to-end grade, since no street anywhere is that steep (Canton Avenue and Baldwin Street are 35 to 37%). And when
  the end-to-end grade is itself over 40%, the endpoints are what is wrong (a 10 m stub with one end on each side of
  a retaining wall: 28 of Seattle's 27,645 streets), so the row is `suspect` with every statistic NULL. Together the
  rules fired on 1.2% of Teaneck's untagged streets.
- **`no_data`**: more than half the samples fell on no-data (or, for a structure, either endpoint did). Every
  statistic is NULL. Shorter gaps are bridged along the profile, which matters for models like AHN that blank every
  building and canal.

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

The production sampler reproduces the study. On all of Teaneck, against the lidar reference: `mean_grade` MAE 0.18 pp,
`max_grade` 0.32 pp, the 5% flag at precision and recall 0.94, and the same 11 of 11 structures the study found from
OSM tags. On all of Seattle (27,645 streets, 13 seconds): `mean_grade` 0.32 pp, `max_grade` 0.40 pp, the 5% flag at
precision 0.98 and recall 0.96, with no measured street over 40%.

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

## Attribution

Most of these models are attribution-only (public domain, CC0, CC BY, or a national open licence), and INEGI also asks
that a transformation be disclosed. `dem_source` on every row is what makes that answerable per street. Where the
credit is shown is part of the API phase of #5223.
