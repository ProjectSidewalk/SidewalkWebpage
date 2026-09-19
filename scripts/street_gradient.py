r"""
Computes each street's gradient (running slope, climb, elevation profile) from a bare-earth elevation model and writes
it to a CSV that ``db/scripts/import-street-gradient.sh`` loads into the ``street_gradient`` table (#5223).

This is a standalone, manually-run utility (it is not invoked by the app). Workflow:

  1. ``make export-street-gradient-input`` writes ``db/onboarding/<city-id>/street_gradient_input.csv``: one row per
     street that has no ``street_gradient`` row yet or whose geometry changed since it was sampled, with columns
     ``street_edge_id, geom_md5, is_structure, geom`` (geom as hex WKB, ``is_structure`` from the street's OSM
     bridge / tunnel / covered tags).
  2. Run (from anywhere — data files are resolved relative to the repo root, not your working directory):

         make street-gradient id=seattle-wa
         make street-gradient id=cdmx \
             args="--dem-dir db/onboarding/cdmx/dem --dem-name inegi-mdt-5m --dem-resolution-m 5"

     The first form picks the elevation source from the city's ``country-id`` in ``conf/cityparams.conf``; the second
     reads GeoTIFFs someone downloaded by hand, for sources that have no scriptable endpoint.
  3. ``make import-street-gradient`` upserts ``db/onboarding/<city-id>/street_gradient.csv`` into the table.

Why a bare-earth model, and why 10 m is enough. Measured against 1 m lidar on ~16,000 streets in eight cities (the
numbers are in ``docs/street-gradient.md``): USGS 3DEP 10 m reproduces mean running grade to 0.08-0.59 percentage
points and the "steeper than 5%" flag at ~0.95 precision and recall, while the global 30 m *surface* models (which
include buildings and tree canopy) read flat Amsterdam as a 6% grade. So the grid size matters far less than whether
the model is bare-earth, and a source is only registered here if it is.

What a bare-earth model cannot see. It removes bridges and knows nothing of tunnels, so a street on a structure
samples the ravine or the hill instead of the deck. Streets tagged as structures are therefore not sampled along their
length: their profile is a straight line between their two endpoint elevations (``structure_interpolated``). Tags miss
some (a lid over a freeway, a street whose ``osm_way_street_edge`` row names a different way of the same road), so a
profile holding a short pitch that is both very steep and wildly out of line with the street's end-to-end grade, or
steeper than any real street, is treated the same way and marked ``suspect``. The grade *of* a bridge deck is out of
reach either way.

Grades are fractions (0.05 is a 5% grade, the OpenSidewalks ``incline`` convention). ``net_grade``, ``climb_m`` and
``descent_m`` follow the street's digitized direction, the rest are direction-free.

The pure functions (``sample_points``, ``bilinear``, ``fill_gaps``, ``smooth``, ``window_grades``, ``grade_metrics``,
``edge_gradient``, ``usgs_13_tile_url``, ``country_id``) are import-safe and unit-tested in
``test/python/test_street_gradient.py``; raster and file I/O live in ``RasterSampler`` and ``main``.
"""

import argparse
import csv
import logging
import math
import re
import sys
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Geod
from rasterio.errors import RasterioIOError
from rasterio.warp import transform as warp_transform
from rasterio.windows import Window
from shapely import wkb

REPO_ROOT = Path(__file__).resolve().parent.parent
CITYPARAMS = REPO_ROOT / 'conf' / 'cityparams.conf'
INPUT_NAME = 'street_gradient_input.csv'
OUTPUT_NAME = 'street_gradient.csv'

GEOD = Geod(ellps='WGS84')

# Spacing of the elevation samples along a street. A model coarser than FINE_RESOLUTION_M is already smooth at this
# scale, so 5 m oversamples it comfortably. A finer one resolves the road crown and curb lines, so it is sampled every
# meter and averaged over SMOOTH_FINE_M before differencing, which is how the 1 m lidar reference was treated.
STEP_COARSE_M = 5.0
STEP_FINE_M = 1.0
FINE_RESOLUTION_M = 5.0
SMOOTH_FINE_M = 5.0

# mean_grade averages the grade over every 10 m baseline. max_grade uses 30 m baselines instead: the maximum of a
# noisy series is biased upward, and against lidar a 10 m maximum carried 3-4x the error of the mean where a 30 m one
# carried about half that.
MEAN_WINDOW_M = 10.0
MAX_WINDOW_M = 30.0
PROFILE_SPACING_M = 10.0
GRADE_THRESHOLDS = (1 / 20, 1 / 12)  # ADA / PROWAG: walking surface 1:20, ramp 1:12.

# A street with more than this share of its samples on no-data has no usable profile. Below it the gaps (AHN blanks
# every building and canal, for one) are bridged along the street.
MAX_NODATA_FRACTION = 0.5

# The artifact rule: some 10 m pitch over SUSPECT_GRADE that is also more than SUSPECT_RATIO times the street's
# end-to-end grade (floored, so a level street needs a 6% pitch's worth of disagreement rather than any at all). On
# the study windows this flags 0.4-1.5% of untagged streets and leaves a uniformly steep hill alone, since its pitch
# and its end-to-end grade agree.
SUSPECT_GRADE = 0.20
SUSPECT_RATIO = 3.0
SUSPECT_NET_FLOOR = 0.02
# No street is steeper than this anywhere (the steepest on record, Pittsburgh's Canton Avenue and Dunedin's Baldwin
# Street, are 35-37%), so a pitch over it is an artifact whatever the end-to-end grade says. When the end-to-end grade
# itself is over it, the endpoints are what is wrong (a 10 m stub whose ends straddle a retaining wall or an abutment:
# 28 of Seattle's 27,645 streets) and there is nothing left to draw a line between.
MAX_PLAUSIBLE_GRADE = 0.40

# Streets are sampled one grid cell at a time so a city never has to fit in memory and GDAL's block cache sees
# neighbors back to back. 0.05 degrees is ~5 km, about one 512-pixel block of a 10 m raster. A fine model gets cells a
# fifth that wide, which keeps one cell's window of a 1 m raster near a million cells instead of 25 million.
CELL_DEGREES = 0.05
CELL_DEGREES_FINE = 0.01

QUALITY_MEASURED = 'measured'
QUALITY_STRUCTURE = 'structure_interpolated'
QUALITY_SUSPECT = 'suspect'
QUALITY_NO_DATA = 'no_data'

OUTPUT_FIELDS = ('street_edge_id', 'quality', 'confidence', 'net_grade', 'mean_grade', 'max_grade',
                 'meters_over_5pct', 'meters_over_8pct', 'climb_m', 'descent_m', 'elev_start_m', 'elev_end_m',
                 'profile_cm', 'dem_source', 'dem_resolution_m', 'geom_md5')

# GDAL's defaults give up on the first dropped connection and list the whole S3 prefix before opening one file.
GDAL_ENV = {'GDAL_HTTP_MAX_RETRY': '5', 'GDAL_HTTP_RETRY_DELAY': '2', 'GDAL_DISABLE_READDIR_ON_OPEN': 'EMPTY_DIR',
            'CPL_VSIL_CURL_ALLOWED_EXTENSIONS': '.tif'}

log = logging.getLogger('street_gradient')

Locator = Callable[[np.ndarray, np.ndarray], list]


# --------------------------------------------------------------------------------------------------------------------
# Geometry and profile math (pure)
# --------------------------------------------------------------------------------------------------------------------


def sample_points(coords: Sequence[tuple[float, float]], step_m: float) -> tuple[np.ndarray, np.ndarray, float]:
    """
    Evenly spaced points along a lng/lat line, both endpoints included.

    The endpoints are exact so that every street meeting at a node samples the same spot and they agree on its
    elevation (as long as the model has data there: over a gap each street fills in from its own nearest sample).
    Spacing is the geodesic length over a whole number of intervals, as close to ``step_m`` as that allows.

    Args:
        coords: The line's (lng, lat) vertices.
        step_m: Target spacing in meters.

    Returns:
        ``(lngs, lats, length_m)``. A line of zero length yields its one point twice.
    """
    lngs, lats = np.array([c[0] for c in coords], float), np.array([c[1] for c in coords], float)
    along = np.concatenate([[0.0], np.cumsum(GEOD.line_lengths(lngs, lats))])
    length = float(along[-1])
    n = max(1, round(length / step_m))
    targets = np.linspace(0.0, length, n + 1)
    # Vertices are tens of meters apart at most, so interpolating lng and lat linearly between them is exact to well
    # under a raster cell.
    return np.interp(targets, along, lngs), np.interp(targets, along, lats), length


def bilinear(grid: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """
    Bilinear interpolation of ``grid`` at fractional (row, col) positions measured in cell centers.

    Returns:
        One value per position, NaN where the position is off the grid or any of its four neighbors is NaN.
    """
    out = np.full(len(rows), np.nan)
    if grid.shape[0] < 2 or grid.shape[1] < 2:
        return out
    inside = (rows >= 0) & (rows <= grid.shape[0] - 1) & (cols >= 0) & (cols <= grid.shape[1] - 1)
    r, c = rows[inside], cols[inside]
    r0 = np.minimum(np.floor(r).astype(int), grid.shape[0] - 2)
    c0 = np.minimum(np.floor(c).astype(int), grid.shape[1] - 2)
    fr, fc = r - r0, c - c0
    out[inside] = (grid[r0, c0] * (1 - fr) * (1 - fc) + grid[r0, c0 + 1] * (1 - fr) * fc
                   + grid[r0 + 1, c0] * fr * (1 - fc) + grid[r0 + 1, c0 + 1] * fr * fc)
    return out


def fill_gaps(z: np.ndarray) -> np.ndarray:
    """Bridges NaN runs linearly along the profile (flat past the first and last known value)."""
    known = ~np.isnan(z)
    return np.interp(np.arange(len(z)), np.flatnonzero(known), z[known])


def smooth(z: np.ndarray, samples: int) -> np.ndarray:
    """
    A centered moving average over ``samples`` points (one more when that is even, so the window has a center).

    The ends are padded by reflecting the profile through its endpoint values, which continues its slope instead of
    flattening it. That leaves a constant grade untouched and both endpoint elevations exactly where they were, so
    the end-to-end grade survives smoothing, where padding with the end value itself would shave about 2% off it.
    """
    samples |= 1
    if samples < 3 or len(z) < samples:
        return z
    padded = np.pad(z, samples // 2, mode='reflect', reflect_type='odd')
    return np.convolve(padded, np.ones(samples) / samples, mode='valid')


def window_grades(z: np.ndarray, length_m: float, window_m: float) -> np.ndarray:
    """
    Absolute grade over every ``window_m`` baseline along an evenly sampled profile.

    Returns:
        One grade per sliding baseline, or the single end-to-end grade when the street is shorter than the baseline.
    """
    step = length_m / (len(z) - 1)
    w = max(1, round(window_m / step))
    if len(z) - 1 < w:
        return np.array([abs(z[-1] - z[0]) / length_m])
    return np.abs(z[w:] - z[:-w]) / (w * step)


def grade_metrics(z: np.ndarray, length_m: float) -> dict:
    """
    The stored statistics of one evenly sampled elevation profile.

    Args:
        z: Elevations in meters, first and last at the street's endpoints, no NaNs.
        length_m: The street's geodesic length, > 0.

    Returns:
        ``net_grade`` (signed, digitized direction), ``mean_grade`` and ``max_grade`` (absolute, see the window
        constants), ``meters_over_5pct`` / ``meters_over_8pct`` (the share of 10 m baselines over each threshold, as a
        length), ``climb_m`` / ``descent_m`` (summed over 10 m steps so sample noise does not accumulate), and
        ``profile_cm`` (elevations every ~10 m, endpoints included, in whole centimeters).
    """
    g_mean, g_max = window_grades(z, length_m, MEAN_WINDOW_M), window_grades(z, length_m, MAX_WINDOW_M)
    step = length_m / (len(z) - 1)
    stride = max(1, round(MEAN_WINDOW_M / step))
    knots = z[::stride] if (len(z) - 1) % stride == 0 else np.append(z[::stride], z[-1])
    dz = np.diff(knots)
    n_profile = max(1, round(length_m / PROFILE_SPACING_M))
    profile = np.interp(np.linspace(0, length_m, n_profile + 1), np.linspace(0, length_m, len(z)), z)
    return {
        'net_grade': float(z[-1] - z[0]) / length_m,
        'mean_grade': float(g_mean.mean()),
        # Floored at the mean: on a bumpy street the 10 m baselines can average more than any 30 m one reaches, and a
        # maximum below the mean reads as a bug to whoever consumes the pair.
        'max_grade': float(max(g_max.max(), g_mean.mean())),
        'meters_over_5pct': float((g_mean > GRADE_THRESHOLDS[0]).mean() * length_m),
        'meters_over_8pct': float((g_mean > GRADE_THRESHOLDS[1]).mean() * length_m),
        'climb_m': float(dz[dz > 0].sum()),
        'descent_m': float(-dz[dz < 0].sum()),
        'profile_cm': [int(round(v * 100)) for v in profile],
    }


def edge_gradient(z: np.ndarray, length_m: float, is_structure: bool, smooth_samples: int = 0) -> dict:
    """
    Turns one street's raw samples into its ``quality`` verdict and statistics.

    Args:
        z: Sampled elevations in meters along the street, NaN where the model has no data.
        length_m: The street's geodesic length.
        is_structure: Whether the street is tagged a bridge, tunnel or covered way.
        smooth_samples: Moving-average width in samples, for a model fine enough to need it.

    Returns:
        ``{'quality': ...}`` alone for ``no_data`` and for a ``suspect`` street whose own endpoints are implausible,
        otherwise that plus ``elev_start_m``, ``elev_end_m`` and everything :func:`grade_metrics` returns. Smoothing
        leaves the endpoint elevations alone (see :func:`smooth`), so streets sharing a node report the same number
        for it.
    """
    missing = np.isnan(z)
    # A structure is read at its two ends only, so what the model holds in between (nothing, under an AHN bridge)
    # does not count against it.
    unusable = (missing[0] or missing[-1]) if is_structure else missing.mean() > MAX_NODATA_FRACTION
    if length_m <= 0 or unusable:
        return {'quality': QUALITY_NO_DATA}
    filled = fill_gaps(z)
    net = abs(filled[-1] - filled[0]) / length_m
    if net > MAX_PLAUSIBLE_GRADE:
        return {'quality': QUALITY_SUSPECT}
    ends = {'elev_start_m': float(filled[0]), 'elev_end_m': float(filled[-1])}
    straight = np.linspace(filled[0], filled[-1], len(filled))
    if is_structure:
        return {'quality': QUALITY_STRUCTURE, **ends, **grade_metrics(straight, length_m)}
    profile = smooth(filled, smooth_samples)
    steepest = float(window_grades(profile, length_m, MEAN_WINDOW_M).max())
    out_of_line = steepest > SUSPECT_GRADE and steepest > SUSPECT_RATIO * max(net, SUSPECT_NET_FLOOR)
    if out_of_line or steepest > MAX_PLAUSIBLE_GRADE:
        return {'quality': QUALITY_SUSPECT, **ends, **grade_metrics(straight, length_m)}
    return {'quality': QUALITY_MEASURED, **ends, **grade_metrics(profile, length_m)}


def confidence_for(resolution_m: float) -> str:
    """
    The tier a bare-earth model's grid size earns: ``high`` to 10 m, ``medium`` to 20 m, ``low`` beyond.

    The cut points are the resolution sweep's: an ideal 10 m model holds the 5% flag at F1 0.94-0.98, a 20 m one at
    0.79-0.95, a 30 m one at 0.70-0.92. The table pins the same mapping in a CHECK constraint.
    """
    if resolution_m <= 10:
        return 'high'
    return 'medium' if resolution_m <= 20 else 'low'


# --------------------------------------------------------------------------------------------------------------------
# Elevation sources
# --------------------------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Source:
    """An elevation model: the name stored in ``dem_source``, its grid size, and how to find the raster for a point."""
    name: str
    resolution_m: float
    locate: Locator


def usgs_13_tile_url(lng: float, lat: float) -> str | None:
    """
    The USGS 3DEP 1/3 arc-second (~10 m) seamless tile holding a point, as a GDAL path.

    Tiles are one degree square, named for their north-west corner, and overlap their neighbors by a few cells.

    Returns:
        A ``/vsicurl/`` path, or None outside the north-west quadrant the naming scheme covers.
    """
    if lat < 0 or lng >= 0:
        return None
    name = f'n{math.floor(lat) + 1:02d}w{-math.floor(lng):03d}'
    return ('/vsicurl/https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/'
            f'{name}/USGS_13_{name}.tif')


def usgs_13_locate(lngs: np.ndarray, lats: np.ndarray) -> list:
    """:func:`usgs_13_tile_url` for each point."""
    return [usgs_13_tile_url(lng, lat) for lng, lat in zip(lngs, lats)]


def directory_locator(dem_dir: Path, opener: Callable = rasterio.open) -> Locator:
    """
    Builds a locator over every GeoTIFF in ``dem_dir``, for models that have to be downloaded by hand.

    The rasters may be in different coordinate systems (adjacent UTM zones, say). Where two overlap, the first in name
    order wins.

    Returns:
        A function mapping points to the path of the raster whose extent holds each, None where none does.
    """
    rasters = []
    for path in sorted(p for p in dem_dir.iterdir() if p.suffix.lower() in ('.tif', '.tiff')):
        with opener(path) as ds:
            rasters.append((str(path), ds.crs, ds.bounds))
    if not rasters:
        sys.exit(f'error: no .tif files in {dem_dir}')

    def locate(lngs: np.ndarray, lats: np.ndarray) -> list:
        found = [None] * len(lngs)
        for path, crs, bounds in rasters:
            xs, ys = warp_transform('EPSG:4326', crs, list(lngs), list(lats))
            for i, (x, y) in enumerate(zip(xs, ys)):
                if found[i] is None and bounds.left <= x <= bounds.right and bounds.bottom <= y <= bounds.top:
                    found[i] = path
        return found
    return locate


USGS_3DEP_10M = Source('usgs-3dep-10m', 10.0, usgs_13_locate)
REMOTE_SOURCES = {USGS_3DEP_10M.name: USGS_3DEP_10M}
# The registered source for each cityparams country-id. A country is only listed once a bare-earth model for it has
# an adapter here. The rest go through --dem-dir until then.
SOURCE_BY_COUNTRY = {'usa': USGS_3DEP_10M.name}


class RasterSampler:
    """Bilinear elevation lookups for batches of lng/lat points, against whichever rasters a locator names."""

    def __init__(self, locate: Locator, opener: Callable = rasterio.open) -> None:
        """
        Args:
            locate: Maps points to raster paths (see :class:`Source`).
            opener: ``rasterio.open`` or a stand-in.
        """
        self._locate = locate
        self._opener = opener
        self._datasets: dict = {}

    def _dataset(self, path: str):
        """
        Returns:
            The open dataset for ``path``, or None when it cannot be opened (an all-ocean USGS tile does not exist),
            remembered either way so a missing tile is asked for once.
        """
        if path not in self._datasets:
            try:
                self._datasets[path] = self._opener(path)
            except RasterioIOError as err:
                log.warning('No raster at %s (%s). Points there get no elevation.', path, err)
                self._datasets[path] = None
        return self._datasets[path]

    def sample(self, lngs: np.ndarray, lats: np.ndarray) -> np.ndarray:
        """
        Returns:
            Elevation in meters per point, NaN where no raster covers it or the raster holds no data there.
        """
        out = np.full(len(lngs), np.nan)
        paths = np.array(self._locate(lngs, lats), dtype=object)
        for path in {p for p in paths if p is not None}:
            ds = self._dataset(path)
            if ds is None:
                continue
            idx = np.flatnonzero(paths == path)
            xs, ys = warp_transform('EPSG:4326', ds.crs, list(lngs[idx]), list(lats[idx]))
            xs, ys, inv = np.array(xs), np.array(ys), ~ds.transform
            # Cell centers, not corners: the value at (row, col) sits at (row + 0.5, col + 0.5) in GDAL's pixel space.
            cols = inv.a * xs + inv.b * ys + inv.c - 0.5
            rows = inv.d * xs + inv.e * ys + inv.f - 0.5
            # The outer half cell of a raster lies beyond its first and last cell centers. Tiles of a national model
            # abut exactly, so at every seam that band is all either neighbor has, and it takes the edge cell's value
            # rather than none.
            on_raster = (rows >= -0.5) & (rows <= ds.height - 0.5) & (cols >= -0.5) & (cols <= ds.width - 0.5)
            if not on_raster.any():
                continue
            idx = idx[on_raster]
            rows, cols = np.clip(rows[on_raster], 0, ds.height - 1), np.clip(cols[on_raster], 0, ds.width - 1)
            r0, c0 = math.floor(rows.min()), math.floor(cols.min())
            r1, c1 = min(ds.height, math.floor(rows.max()) + 2), min(ds.width, math.floor(cols.max()) + 2)
            # A single row or column cannot be interpolated, so the window reaches back one cell at the far edge.
            r0, c0 = max(0, min(r0, r1 - 2)), max(0, min(c0, c1 - 2))
            grid = ds.read(1, window=Window(c0, r0, c1 - c0, r1 - r0), masked=True).astype(float).filled(np.nan)
            # rasterio hands back stored values. GEDTM30, for one, stores decimeters with a 0.1 scale.
            grid = grid * ds.scales[0] + ds.offsets[0]
            out[idx] = bilinear(grid, rows - r0, cols - c0)
        return out

    def close(self) -> None:
        """Closes every raster this sampler opened."""
        for ds in self._datasets.values():
            if ds is not None:
                ds.close()
        self._datasets = {}


# --------------------------------------------------------------------------------------------------------------------
# Config and CSV I/O
# --------------------------------------------------------------------------------------------------------------------


def country_id(city_id: str, conf_text: str) -> str | None:
    """
    A city's ``country-id`` from the text of ``conf/cityparams.conf``.

    Follows one ``${city-params.country-id.<other>}`` substitution, the form study and staging deployments use to
    borrow their parent city's value.

    Returns:
        The country id, or None when the city has no entry or a null one.
    """
    block = re.search(r'^\s*country-id\s*\{(.*?)^\s*\}', conf_text, re.S | re.M)
    entries = dict(re.findall(r'^\s*([\w-]+)\s*=\s*(\S+)\s*$', block.group(1), re.M)) if block else {}
    value = entries.get(city_id)
    alias = re.fullmatch(r'\$\{city-params\.country-id\.([\w-]+)\}', value or '')
    if alias:
        value = entries.get(alias.group(1))
    return None if value in (None, 'null') else value.strip('"')


def valid_city_id(value: str) -> str:
    """argparse type for ``--city-id``: the cityparams id shape, which also keeps the value safe inside a path."""
    if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', value):
        raise argparse.ArgumentTypeError(f'"{value}" — use lowercase kebab-case, e.g. "newport-ky".')
    return value


def read_streets(path: Path) -> list[dict]:
    """
    Reads the export.

    Returns:
        One dict per street: ``street_edge_id`` (int), ``geom_md5``, ``is_structure`` (bool), ``coords`` (the
        line's lng/lat vertices).
    """
    with path.open(newline='') as f:
        return [{'street_edge_id': int(row['street_edge_id']), 'geom_md5': row['geom_md5'],
                 'is_structure': row['is_structure'] == 't',
                 'coords': list(wkb.loads(row['geom'], hex=True).coords)} for row in csv.DictReader(f)]


def done_ids(path: Path) -> set[int]:
    """
    The street ids an earlier, interrupted run already wrote to ``path``.

    A run killed mid-write leaves a partial last line. It is cut off first: read as a row it would mark a street done
    that is not (or, cut inside the id, a different street), and the resumed run would append onto the end of it.
    """
    if not path.exists():
        return set()
    data = path.read_bytes()
    if not data.endswith(b'\n'):
        path.write_bytes(data[:data.rfind(b'\n') + 1])
    with path.open(newline='') as f:
        return {int(row['street_edge_id']) for row in csv.DictReader(f)}


def format_row(street: dict, result: dict, source_name: str, resolution_m: float) -> dict:
    """One output CSV row: grades to 1e-5, meters to the centimeter, NULLs empty, the profile a Postgres array."""
    row = {'street_edge_id': street['street_edge_id'], 'quality': result['quality'],
           'confidence': confidence_for(resolution_m), 'dem_source': source_name, 'dem_resolution_m': resolution_m,
           'geom_md5': street['geom_md5']}
    for field in ('net_grade', 'mean_grade', 'max_grade'):
        row[field] = f'{result[field]:.5f}' if field in result else ''
    for field in ('meters_over_5pct', 'meters_over_8pct', 'climb_m', 'descent_m', 'elev_start_m', 'elev_end_m'):
        row[field] = f'{result[field]:.2f}' if field in result else ''
    row['profile_cm'] = '{' + ','.join(map(str, result['profile_cm'])) + '}' if 'profile_cm' in result else ''
    return row


def cells(streets: Iterable[dict], cell_degrees: float) -> list[list[dict]]:
    """Groups streets by the ``cell_degrees`` grid cell of their first vertex, cells in row-major order."""
    grouped: dict = {}
    for street in streets:
        lng, lat = street['coords'][0]
        grouped.setdefault((math.floor(lat / cell_degrees), math.floor(lng / cell_degrees)), []).append(street)
    return [grouped[key] for key in sorted(grouped)]


def process_cell(streets: list[dict], sampler: RasterSampler, source: Source) -> list[dict]:
    """
    Samples every street of one cell in a single raster read.

    Returns:
        One output row per street, in the order given.
    """
    fine = source.resolution_m < FINE_RESOLUTION_M
    step = STEP_FINE_M if fine else STEP_COARSE_M
    sampled = [sample_points(street['coords'], step) for street in streets]
    z_all = sampler.sample(np.concatenate([s[0] for s in sampled]), np.concatenate([s[1] for s in sampled]))
    rows, start = [], 0
    for street, (lngs, _, length) in zip(streets, sampled):
        z = z_all[start:start + len(lngs)]
        start += len(lngs)
        result = edge_gradient(z, length, street['is_structure'], round(SMOOTH_FINE_M / step) if fine else 0)
        rows.append(format_row(street, result, source.name, source.resolution_m))
    return rows


# --------------------------------------------------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------------------------------------------------


def resolve_source(args: argparse.Namespace, conf_text: str, opener: Callable = rasterio.open) -> Source:
    """
    Picks the elevation source: hand-downloaded rasters when ``--dem-dir`` is given, else ``--source``, else the one
    registered for the city's country. Exits with what to do instead when none of those yields one.
    """
    if args.dem_dir:
        if not (args.dem_name and args.dem_resolution_m):
            sys.exit('error: --dem-dir also needs --dem-name (stored as dem_source) and --dem-resolution-m.')
        dem_dir = args.dem_dir if args.dem_dir.is_absolute() else REPO_ROOT / args.dem_dir
        return Source(args.dem_name, args.dem_resolution_m, directory_locator(dem_dir, opener))
    country = country_id(args.city_id, conf_text)
    name = args.source or SOURCE_BY_COUNTRY.get(country)
    if name is None:
        sys.exit(f'error: no elevation source is registered for country-id "{country}" ({args.city_id}). Download '
                 'a bare-earth model for the city and pass --dem-dir, --dem-name and --dem-resolution-m. '
                 'docs/street-gradient.md lists the known sources per country.')
    return REMOTE_SOURCES[name]


def main(argv: list[str] | None = None, opener: Callable = rasterio.open) -> int:
    """
    Samples every street in the city's export and writes ``street_gradient.csv`` beside it.

    Rows are flushed a cell at a time, so ``--resume`` after an interruption skips what is already written.

    Returns:
        0 on success.
    """
    parser = argparse.ArgumentParser(description='Compute street gradients from a bare-earth elevation model.')
    parser.add_argument('--city-id', required=True, type=valid_city_id,
                        help='The cityparams city id, e.g. "seattle-wa"; data files live in db/onboarding/<city-id>/.')
    parser.add_argument('--source', choices=sorted(REMOTE_SOURCES),
                        help="Override the elevation source registered for the city's country.")
    parser.add_argument('--dem-dir', type=Path,
                        help='A directory of hand-downloaded bare-earth GeoTIFFs (elevations in meters) to use '
                             'instead of a registered source; relative paths are taken from the repo root.')
    parser.add_argument('--dem-name', help='With --dem-dir: the source name to record, e.g. "inegi-mdt-5m".')
    parser.add_argument('--dem-resolution-m', type=float, help="With --dem-dir: the model's grid size in meters.")
    parser.add_argument('--resume', action='store_true',
                        help='Keep the rows an interrupted run already wrote and sample only the remaining streets.')
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format='%(message)s')

    city_dir = REPO_ROOT / 'db' / 'onboarding' / args.city_id
    in_path, out_path = city_dir / INPUT_NAME, city_dir / OUTPUT_NAME
    if not in_path.exists():
        sys.exit(f'error: {in_path} not found. Run `make export-street-gradient-input` first.')
    source = resolve_source(args, CITYPARAMS.read_text(), opener)

    streets = read_streets(in_path)
    skip = done_ids(out_path) if args.resume else set()
    todo = [street for street in streets if street['street_edge_id'] not in skip]
    log.info('%s: %d street(s) to sample from %s (%d already done).', args.city_id, len(todo), source.name,
             len(streets) - len(todo))

    sampler = RasterSampler(source.locate, opener)
    counts: dict = {}
    with rasterio.Env(**GDAL_ENV), out_path.open('a' if skip else 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDS)
        if not skip:
            writer.writeheader()
        for batch in cells(todo, CELL_DEGREES_FINE if source.resolution_m < FINE_RESOLUTION_M else CELL_DEGREES):
            rows = process_cell(batch, sampler, source)
            writer.writerows(rows)
            f.flush()
            for row in rows:
                counts[row['quality']] = counts.get(row['quality'], 0) + 1
    sampler.close()
    log.info('Wrote %s: %s.', out_path, ', '.join(f'{n} {quality}' for quality, n in sorted(counts.items())) or
             'nothing new')
    return 0


if __name__ == '__main__':
    sys.exit(main())
