"""
Unit tests for tools/city/tracker_coverage_by_region.py, which reports imagery coverage per region from Streetscape
Tracker road walks (#5960).

The walks and regions are tiny files written to tmp_path, so nothing here touches the network. Needs geopandas, so it
runs in the web container half only.
"""

import pandas as pd
import pytest

gpd = pytest.importorskip('geopandas')
from shapely.geometry import box  # noqa: E402

import tracker_coverage_by_region as tcr  # noqa: E402

GSV_HEADER = 'query_lat,query_lon,query_timestamp,pano_lat,pano_lon,pano_id,capture_date,copyright_info,status\n'
# Four samples in the west region: an official pano, a user upload, a pano 100+ m away, and nothing. One sample in
# the east region with nothing, and one outside both regions and the boundary.
GSV_ROWS = [
    '0.0010,0.0010,t,0.0010,0.0010,a,2022-08-01,© Google,OK',
    '0.0020,0.0010,t,0.0020,0.0010,b,2018-01-01,© Someone,OK',
    '0.0030,0.0010,t,0.0040,0.0010,c,2023-01-01,© Google,OK',
    '0.0040,0.0010,t,,,,,,ZERO_RESULTS',
    '0.0010,0.0110,t,,,,,,ZERO_RESULTS',
    '0.0010,0.0310,t,0.0010,0.0310,d,2023-04-01,© Google,OK',
]
MAPILLARY_HEADER = GSV_HEADER.rstrip('\n') + ',is_pano\n'
MAPILLARY_ROWS = [
    '0.0010,0.0010,t,0.0010,0.0010,1,2023-01-17,© Mapillary contributor 1,OK,True',
    '0.0020,0.0010,t,0.0020,0.0010,2,,© Mapillary contributor 1,FLAT_ONLY,False',
]


@pytest.fixture
def workspace(tmp_path):
    """Writes two regions, a boundary around them, and one walk per provider."""
    regions = gpd.GeoDataFrame({'nm': ['West', 'East']}, geometry=[box(0, 0, 0.01, 0.01), box(0.01, 0, 0.02, 0.01)],
                               crs='EPSG:4326')
    regions.to_file(tmp_path / 'regions.geojson', driver='GeoJSON')
    gpd.GeoDataFrame(geometry=[box(0, 0, 0.02, 0.01)], crs='EPSG:4326').to_file(tmp_path / 'boundary.geojson',
                                                                               driver='GeoJSON')
    (tmp_path / 'gsv.csv').write_text(GSV_HEADER + '\n'.join(GSV_ROWS) + '\n', encoding='utf-8')
    (tmp_path / 'mapillary.csv').write_text(MAPILLARY_HEADER + '\n'.join(MAPILLARY_ROWS) + '\n', encoding='utf-8')
    return tmp_path


def test_haversine_is_about_111_km_per_degree_of_latitude():
    assert tcr.haversine_m([0], [0], [1], [0])[0] == pytest.approx(111195, rel=1e-3)


def test_summarize_of_no_samples_reports_blanks_not_zero_coverage(workspace):
    empty = tcr.load_walk('gsv', workspace / 'gsv.csv').iloc[0:0]
    summary = tcr.summarize(empty, 15)
    assert summary['samples'] == 0
    assert pd.isna(summary['covered_pct']) and pd.isna(summary['since_2022_pct'])
    assert summary['median_capture'] == ''


def test_markdown_table_blanks_missing_values():
    table = tcr.markdown_table(pd.DataFrame({'a': [1.5], 'b': [float('nan')]}))
    assert table.splitlines() == ['| a | b |', '|---|---|', '| 1.5 |  |']


def test_report_with_a_boundary(workspace, capsys):
    out = workspace / 'out'
    code = tcr.main(['--regions', str(workspace / 'regions.geojson'), '--name-col', 'nm',
                     '--boundary', str(workspace / 'boundary.geojson'),
                     '--walk', f"gsv={workspace / 'gsv.csv'}", '--walk', f"mapillary={workspace / 'mapillary.csv'}",
                     '--out-dir', str(out)])
    assert code == 0
    table = pd.read_csv(out / 'coverage_by_region.csv').set_index(['provider', 'region'])

    west = table.loc[('gsv', 'West')]
    assert west['samples'] == 4
    # The far pano and the miss don't count; the user upload is covered but not official.
    assert west['covered_pct'] == 50.0 and west['official_pct'] == 25.0
    assert west['median_capture'] == '2020-04' and west['newest_capture'] == '2022-08'
    assert west['since_2022_pct'] == 25.0
    assert table.loc[('gsv', 'East'), 'covered_pct'] == 0.0

    # The sample east of the boundary is in the rectangle row and nowhere else.
    assert table.loc[('gsv', 'WHOLE CITY (inside boundary)'), 'samples'] == 5
    assert table.loc[('gsv', 'tracker rectangle (all samples)'), 'samples'] == 6

    flat = table.loc[('mapillary', 'West')]
    assert flat['covered_pct'] == 50.0 and flat['official_pct'] == 50.0 and flat['flat_only_pct'] == 50.0

    report = (out / 'coverage_by_region.md').read_text(encoding='utf-8')
    assert '## gsv' in report and '## mapillary' in report
    # The sample extent is the bounding box of the samples, which here spans only the southern strip of the boundary.
    assert "gsv: the walk's sample extent reaches 28% of the city boundary" in report
    assert '## gsv' in capsys.readouterr().out


def test_report_without_a_boundary_has_no_city_row(workspace):
    out = workspace / 'out'
    tcr.main(['--regions', str(workspace / 'regions.geojson'), '--name-col', 'nm',
              '--walk', f"gsv={workspace / 'gsv.csv'}", '--out-dir', str(out)])
    regions = set(pd.read_csv(out / 'coverage_by_region.csv')['region'])
    assert regions == {'tracker rectangle (all samples)', 'West', 'East'}
