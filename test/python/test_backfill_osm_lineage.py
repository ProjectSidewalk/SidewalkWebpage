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


def test_hull_of_widens_the_streets_convex_hull():
    streets = [(1, 'x', [], lonlat((0, 0), (100, 0))), (2, 'x', [], lonlat((0, 100), (100, 100)))]
    hull = bl.hull_of(streets, 50)
    assert hull.contains(lonlat((0, 0), (100, 100)))
    assert hull.contains(lonlat((-40, 0), (140, 100)))
    assert not hull.contains(lonlat((-70, 0), (0, 0)))


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

    def fetch(poly, include_alleys, buffer_m, fresh=False):
        seen['poly'], seen['alleys'], seen['fresh'] = poly, include_alleys, fresh
        return gpd.GeoDataFrame({'osm_way_id': [10], 'highway': ['residential']}, geometry=[way], crs='EPSG:4326')

    with caplog.at_level(logging.INFO):
        assert bl.main(['--city-id', 'testville'], fetch=fetch) == 0
    assert seen['alleys'] and seen['fresh'] and seen['poly'].contains(way)
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


def test_parse_args_validates_the_city_id():
    with pytest.raises(SystemExit):
        bl.parse_args(['--city-id', 'Test Ville'])
    assert bl.parse_args(['--city-id', 'testville', '--fetch-buffer-m', '20']).fetch_buffer_m == 20.0
