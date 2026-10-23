"""Unit tests for tools/city/backfill_osm_lineage.py (#5741): a live city's streets positioned on today's OSM ways."""
import csv
import logging
import sys
from pathlib import Path

import geopandas as gpd
import pytest
from shapely.geometry import LineString

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'tools' / 'city'))
import backfill_osm_lineage as bl  # noqa: E402
import osm_lineage as ol  # noqa: E402

M = 1 / 111_320


def lonlat(*points_m):
    return LineString([(x * M, y * M) for x, y in points_m])


def write_input(path, rows):
    with open(path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=bl.INPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def input_row(street_edge_id, geom, way_ids, geom_md5='abc'):
    return {'street_edge_id': street_edge_id, 'geom_md5': geom_md5, 'osm_way_ids': way_ids, 'geom': geom.wkb_hex}


def test_read_input_parses_ids_and_geometry_and_drops_the_infra3d_placeholder(tmp_path):
    path = tmp_path / bl.INPUT_NAME
    write_input(path, [input_row(1, lonlat((0, 0), (10, 0)), '100,101'), input_row(2, lonlat((0, 5), (10, 5)), '-1'),
                       input_row(3, lonlat((0, 9), (10, 9)), '')])
    streets = bl.read_input(path)
    assert [(s[0], s[1], s[2]) for s in streets] == [(1, 'abc', [100, 101]), (2, 'abc', []), (3, 'abc', [])]
    assert streets[0][3].equals(lonlat((0, 0), (10, 0)))


def test_read_input_refuses_another_file_s_columns(tmp_path):
    path = tmp_path / 'wrong.csv'
    path.write_text('street_edge_id,geom\n1,00\n')
    with pytest.raises(SystemExit, match='does not have the columns'):
        bl.read_input(path)


def test_tiles_cover_the_streets_with_a_buffer_and_skip_the_ground_between_far_apart_towns():
    # Two towns 30 km apart with nothing between them: one hull would ask for all of it, the tiles for two patches.
    west = [lonlat((0, 0), (1500, 0)), lonlat((0, 500), (0, 1200))]
    east = [lonlat((30_000, 0), (30_000, 900))]
    tiling = bl.tiles_for(west + east, buffer_m=100, tile_km2=300)
    assert len(tiling.polygons) == 2
    assert all(any(tile.contains(line) for tile in tiling.polygons) for line in west + east)
    assert tiling.polygons[0].contains(lonlat((-90, 0), (1590, 0)))
    assert not tiling.polygons[0].contains(lonlat((-200, 0), (0, 0)))
    assert tiling.cells_km2 == 4.0  # Two cells along the west street, one above it, one for the east.
    assert tiling.area_km2 < 8 and tiling.hull_km2 > 30 * 1.2
    assert str(tiling).startswith('2 Overpass request(s) over ') and 'one hull around them would be ' in str(tiling)


def test_tiles_split_a_big_city_by_area_and_mark_every_cell_a_long_street_crosses():
    # One 40 km street: 40 cells, which a 100 km² tile (10 cells a side) cuts into four requests.
    tiling = bl.tiles_for([lonlat((0, 500), (40_000, 500))], buffer_m=0, tile_km2=100)
    assert len(tiling.polygons) == 4 and tiling.cells_km2 == 40.0
    assert tiling.area_km2 == pytest.approx(40.0, rel=0.02)
    assert bl.tiles_for([], buffer_m=100).polygons == []


def test_outputs_carry_the_hash_and_list_only_the_streets_to_review():
    way = lonlat((0, 0), (100, 0))
    streets = [(1, 'h1', [10], way), (2, 'h2', [10, 77], lonlat((0, 50), (100, 50)))]
    lineages = ol.compute_lineage(((i, g, h) for i, _, h, g in streets), {10: way})
    rows = bl.lineage_output(streets, lineages)
    assert rows[0] == {'street_edge_id': 1, 'osm_way_id': 10, 'street_from_frac': '0.0', 'street_to_frac': '1.0',
                       'way_from_frac': '0.0', 'way_to_frac': '1.0', 'same_direction': 't', 'geom_md5': 'h1'}
    assert [(r['street_edge_id'], r['osm_way_id'], r['street_from_frac'], r['same_direction'], r['geom_md5'])
            for r in rows[1:]] == [(2, 10, '', '', 'h2'), (2, 77, '', '', 'h2')]
    review = bl.review_output(streets, lineages)
    assert review == [{'street_edge_id': 2, 'status': 'unmatched', 'coverage': '0.000', 'osm_way_ids': '10,77',
                       'geom_wkt': streets[1][3].wkt}]


def test_main_matches_the_export_and_writes_both_files(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(bl, 'REPO_ROOT', tmp_path)
    city_dir = tmp_path / 'db' / 'onboarding' / 'testville'
    city_dir.mkdir(parents=True)
    way = lonlat((0, 0), (100, 0))
    write_input(city_dir / bl.INPUT_NAME, [input_row(1, way, '10'), input_row(2, lonlat((0, 300), (100, 300)), '10')])
    seen = {}

    def fetch(polygons, way_types, **kwargs):
        seen['polygons'], seen['way_types'], seen['kwargs'] = polygons, way_types, kwargs
        return gpd.GeoDataFrame({'osm_way_id': [10], 'highway': ['residential']}, geometry=[way], crs='EPSG:4326')

    def probe(policy, url):
        seen['probed'], seen['probe_url'] = policy, url

    with caplog.at_level(logging.INFO):
        assert bl.main(['--city-id', 'testville', '--request-timeout-s', '90', '--pause-s', '3', '--overpass-url',
                        'https://x/api'], fetch=fetch, probe=probe) == 0
    assert seen['way_types'] == 'any' and len(seen['polygons']) == 1 and seen['polygons'][0].contains(way)
    assert seen['kwargs'] == {'request_timeout_s': 90, 'memory_mb': 256, 'pause_s': 3.0, 'policy': seen['probed'],
                              'one_request_each': True, 'overpass_url': 'https://x/api'}
    assert seen['probe_url'] == 'https://x/api'
    assert any('1 Overpass request(s) over' in r.message for r in caplog.records)
    with open(city_dir / bl.OUTPUT_NAME, newline='') as f:
        rows = list(csv.DictReader(f))
    assert [(r['street_edge_id'], r['osm_way_id'], r['street_to_frac']) for r in rows] == [('1', '10', '1.0'),
                                                                                           ('2', '10', '')]
    with open(city_dir / bl.REVIEW_NAME, newline='') as f:
        review = list(csv.DictReader(f))
    assert [(r['street_edge_id'], r['status']) for r in review] == [('2', 'unmatched')]
    assert any('Matched 1 streets along their whole length, 0 in part, 1 not at all' in r.message
               for r in caplog.records)


def test_main_needs_the_export_and_at_least_one_street(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(bl, 'REPO_ROOT', tmp_path)
    city_dir = tmp_path / 'db' / 'onboarding' / 'testville'
    city_dir.mkdir(parents=True)
    with caplog.at_level(logging.ERROR):
        assert bl.main(['--city-id', 'testville'], fetch=None) == 1
    assert any('export-osm-lineage-input' in r.message for r in caplog.records)
    write_input(city_dir / bl.INPUT_NAME, [])
    assert bl.main(['--city-id', 'testville'], fetch=None) == 1
    assert any('holds no streets' in r.message for r in caplog.records)


def test_main_dry_run_reports_the_requests_and_fetches_nothing(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(bl, 'REPO_ROOT', tmp_path)
    city_dir = tmp_path / 'db' / 'onboarding' / 'testville'
    city_dir.mkdir(parents=True)
    write_input(city_dir / bl.INPUT_NAME, [input_row(1, lonlat((0, 0), (100, 0)), '10')])
    with caplog.at_level(logging.INFO):
        assert bl.main(['--city-id', 'testville', '--dry-run'], fetch=None, probe=None) == 0
    assert any('1 Overpass request(s) over' in r.message for r in caplog.records)
    assert not (city_dir / bl.OUTPUT_NAME).exists()


def test_main_exits_75_and_writes_nothing_when_overpass_will_not_answer(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(bl, 'REPO_ROOT', tmp_path)
    city_dir = tmp_path / 'db' / 'onboarding' / 'testville'
    city_dir.mkdir(parents=True)
    write_input(city_dir / bl.INPUT_NAME, [input_row(1, lonlat((0, 0), (100, 0)), '10')])

    def refusing(policy, url):
        raise bl.OverpassUnavailable('Overpass probe: still not answering after 5 attempt(s)')
    with caplog.at_level(logging.ERROR):
        assert bl.main(['--city-id', 'testville'], fetch=None, probe=refusing) == 75
    assert any('Nothing was written for testville' in r.message for r in caplog.records)
    assert not (city_dir / bl.OUTPUT_NAME).exists()

    def fetch(polygons, way_types, **kwargs):
        raise bl.OverpassUnavailable('request 1/1: still not answering')
    assert bl.main(['--city-id', 'testville'], fetch=fetch, probe=lambda policy, url: None) == 75

    # A status the retry does not cover is Overpass turning us away all the same; anything else is a bug and raised.
    class ResponseStatusCodeError(Exception):
        pass

    def refused(polygons, way_types, **kwargs):
        raise ResponseStatusCodeError('Overpass API at https://x/api/interpreter responded: 403 Forbidden')
    with caplog.at_level(logging.ERROR):
        assert bl.main(['--city-id', 'testville'], fetch=refused, probe=lambda policy, url: None) == 75
    assert any('refused the query' in r.message for r in caplog.records)

    def broken(polygons, way_types, **kwargs):
        raise KeyError('node')
    with pytest.raises(KeyError):
        bl.main(['--city-id', 'testville'], fetch=broken, probe=lambda policy, url: None)


def test_parse_args_validates_the_city_id():
    with pytest.raises(SystemExit):
        bl.parse_args(['--city-id', 'Test Ville'])
    args = bl.parse_args(['--city-id', 'testville', '--fetch-buffer-m', '20'])
    assert (args.fetch_buffer_m, args.tile_km2, args.request_timeout_s, args.request_memory_mb, args.pause_s,
            args.dry_run, args.overpass_url) == (20.0, 300.0, 60, 256, 7.0, False, bl.OVERPASS_URL)
