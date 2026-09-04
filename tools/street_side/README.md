# Street-side assignment experiment (#2886)

Offline evidence tool for [issue #2886](https://github.com/ProjectSidewalk/SidewalkWebpage/issues/2886): which side of
its street each label sits on, computed two ways and scored against SDOT's sidewalk and curb-ramp inventories. The
report it feeds is `docs/experiments/2026-09-03-street-side-assignment.md`.

Nothing here touches the app: every derived table lives in a scratch schema (`experiment_2886` by default) that the
city role creates, and the city schema is only read. Drop the scratch schema to remove every trace.

## Pipeline

```bash
# 1. SDOT layers -> GeoJSON (network; ~200 MB into tools/street_side/data/, gitignored)
python3.13 tools/street_side/download_sdot.py tools/street_side/data
# 2..4 inside the web container (python3.13 holds pandas; psycopg2/matplotlib/tabulate are pip-installed there)
docker exec -w /home/<worktree> projectsidewalk-web python3.13 tools/street_side/street_side.py load
docker exec -w /home/<worktree> projectsidewalk-web python3.13 tools/street_side/street_side.py compute   # ~4 min
docker exec -w /home/<worktree> projectsidewalk-web python3.13 tools/street_side/street_side.py export
docker exec -w /home/<worktree> projectsidewalk-web python3.13 tools/street_side/analyze_street_side.py
docker exec -w /home/<worktree> projectsidewalk-web python3.13 tools/street_side/case_maps.py   # maps of the worked examples
```

`--city` / `--exp` pick the city schema and the scratch schema; `PGUSER` / `PGPASSWORD` are the city role.

## What is computed

- **Side convention**: `+1` = left of the street edge's digitized direction, `-1` = right. Relative to the edge, not
  cardinal, because a persisted `street_side` column has to work on diagonal streets.
- **Geometric method** (`geo_side`): which side of the edge the *estimated label position* falls on, with the
  geodesic distance to the centerline as its margin.
- **Heading method** (`head_side`): the sign of the angle between the camera-to-label bearing (from `pano_x` and the
  pano's `camera_heading`, exactly what `PanoDataService.calculatePovFromPanoXY` computes) and the road bearing at the
  camera's foot point. Never reads the label position; its margin is `axis_angle_deg`, the ray's angle off the road
  axis.
- **Frames**: both methods are computed against the audited street (`label.street_edge_id`), the street nearest the
  label, and the street nearest the camera.
- **Stability**: the geometric side is also computed on the pre-#4818 `approximation2` position kept in
  `old_label_point_position` (evolution 352).
- **Ground truth** from SDOT ([Sidewalks](https://data-seattlecitygis.opendata.arcgis.com/datasets/sidewalks),
  [Curb Ramps](https://data-seattlecitygis.opendata.arcgis.com/datasets/curb-ramps), pulled 2026-09-03): sidewalks are
  resampled every 4 m and attached to the parallel street edge within 18 m, giving per-side coverage per edge; on an
  edge paved along one side only, a NoSidewalk label belongs on the bare side and an Obstacle/SurfaceProblem label on
  the paved side, independent of where the label's position was estimated. Curb-ramp labels are matched to the nearest
  SDOT ramp point, whose side of the audited edge is the truth when no ramp on the other side sits within 3 m of the
  same distance.

Outputs land in `tools/street_side/out/` (gitignored except the figures the report embeds): `summary.json` holds every
number, `tables.md` the tables, `hand_label_sample.csv` a stratified sample for a human cross-check, and `cases.csv`
the six rule-picked labels (the median-distance member of each situation's candidate set) that `case_maps.py` draws
from the scratch schema as `fig_cases.png`.
