"""
Unit tests for scripts/label_clustering.py.

Covers the pure clustering pipeline (distance metric, cleaning, per-type clustering, cluster-id offsetting, JSON
assembly) and the `main` orchestration / I/O wrappers (with the network mocked). See test/python/README.md.
"""

import json
import sys

import numpy as np
import pandas as pd
import pytest
import requests
from haversine import haversine

import label_clustering as lc


class _SyncExecutor:
    """Drop-in for ProcessPoolExecutor that runs map() synchronously, so main() is deterministic and coverable."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def map(self, fn, iterable):
        return [fn(item) for item in iterable]


# --------------------------------------------------------------------------------------------------------------------
# custom_dist
# --------------------------------------------------------------------------------------------------------------------

def test_custom_dist_same_user_and_pano_never_clusters():
    point = [47.60, -122.30, 1, 'panoA']
    # Same user (index 2) AND same pano (index 3): max float so the two are never clustered together.
    assert lc.custom_dist(point, list(point)) == sys.float_info.max


def test_custom_dist_same_user_different_pano_uses_haversine():
    u = [47.60, -122.30, 1, 'panoA']
    v = [47.6005, -122.30, 1, 'panoB']  # same user, different pano -> not the max-float short circuit
    assert lc.custom_dist(u, v) == pytest.approx(haversine([u[0], u[1]], [v[0], v[1]]))


def test_custom_dist_different_user_same_pano_uses_haversine():
    u = [47.60, -122.30, 1, 'panoA']
    v = [47.6005, -122.30, 2, 'panoA']  # different user, same pano -> not the max-float short circuit
    assert lc.custom_dist(u, v) == pytest.approx(haversine([u[0], u[1]], [v[0], v[1]]))


# --------------------------------------------------------------------------------------------------------------------
# clean_label_data
# --------------------------------------------------------------------------------------------------------------------

def test_clean_label_data_drops_invalid_and_nan_longitudes():
    df = pd.DataFrame({'lng': [-122.30, 500.0, np.nan, -122.31]})
    assert lc.clean_label_data(df)['lng'].tolist() == [-122.30, -122.31]


def test_clean_label_data_leaves_valid_rows_untouched():
    df = pd.DataFrame({'lng': [-122.30, -122.31]})
    assert lc.clean_label_data(df)['lng'].tolist() == [-122.30, -122.31]


# --------------------------------------------------------------------------------------------------------------------
# cluster
# --------------------------------------------------------------------------------------------------------------------

def _label_frame(severities=(3.0, 5.0, 1.0)):
    """Two near labels (different users, ~5 m apart) plus one ~11 km away."""
    df = pd.DataFrame({
        'label_id': [1, 2, 3],
        'label_type': ['Obstacle', 'Obstacle', 'Obstacle'],
        'lat': [47.6000, 47.60005, 47.7000],
        'lng': [-122.3000, -122.3000, -122.3000],
        'user_id': [10, 20, 30],
        'pano_id': ['a', 'b', 'c'],
        'severity': list(severities),
    })
    df['coords'] = list(zip(df['lat'], df['lng']))
    return df


def test_cluster_groups_near_points_and_separates_far_points():
    cluster_df, labeled = lc.cluster(_label_frame(), 'Obstacle', lc.THRESHOLDS)
    assert labeled['cluster'].nunique() == 2
    assert len(cluster_df) == 2
    # Median severity of the merged pair is round((3+5)/2)=4; the lone far label keeps severity 1.
    assert sorted(int(s) for s in cluster_df['severity']) == [1, 4]


def test_cluster_with_all_null_severity_yields_none():
    df = _label_frame(severities=(np.nan, np.nan, np.nan))
    cluster_df, _ = lc.cluster(df, 'Obstacle', lc.THRESHOLDS)
    assert cluster_df['severity'].isnull().all()


# --------------------------------------------------------------------------------------------------------------------
# cluster_label_type
# --------------------------------------------------------------------------------------------------------------------

def _typed_frame(rows):
    """Build a coords-bearing frame from (label_id, label_type, lat, lng, user_id, pano_id, severity) tuples."""
    df = pd.DataFrame(rows, columns=['label_id', 'label_type', 'lat', 'lng', 'user_id', 'pano_id', 'severity'])
    df['coords'] = list(zip(df['lat'], df['lng']))
    return df


def test_cluster_label_type_multiple_labels_clusters():
    df = _typed_frame([
        (1, 'CurbRamp', 47.6000, -122.3000, 10, 'a', 1.0),
        (2, 'CurbRamp', 47.60003, -122.3000, 20, 'b', 2.0),
    ])
    label_type, clusters, labels = lc.cluster_label_type('CurbRamp', df, lc.THRESHOLDS)
    assert label_type == 'CurbRamp'
    assert len(labels) == 2
    assert len(clusters) >= 1


def test_cluster_label_type_single_label_is_its_own_cluster():
    df = _typed_frame([(1, 'Signal', 47.6, -122.3, 10, 'a', 3.0)])
    _, clusters, labels = lc.cluster_label_type('Signal', df, lc.THRESHOLDS)
    assert labels['cluster'].tolist() == [1]
    assert list(clusters.columns) == lc.CLUSTER_COLS


def test_cluster_label_type_absent_type_returns_empty():
    df = _typed_frame([(1, 'Signal', 47.6, -122.3, 10, 'a', 3.0)])
    _, clusters, labels = lc.cluster_label_type('Crosswalk', df, lc.THRESHOLDS)
    assert labels.empty
    assert clusters.empty


def test_cluster_label_type_problem_aggregates_component_types():
    # 'Problem' pulls together SurfaceProblem / Obstacle / NoCurbRamp rows.
    df = _typed_frame([
        (1, 'SurfaceProblem', 47.6000, -122.3000, 10, 'a', 1.0),
        (2, 'Obstacle', 47.60003, -122.3000, 20, 'b', 2.0),
        (3, 'CurbRamp', 47.8000, -122.3000, 30, 'c', 3.0),  # excluded from 'Problem'
    ])
    _, clusters, labels = lc.cluster_label_type('Problem', df, lc.THRESHOLDS)
    assert len(labels) == 2  # only the two PROBLEM_TYPES rows
    assert (clusters['label_type'] == 'Problem').all()


# --------------------------------------------------------------------------------------------------------------------
# offset_and_combine
# --------------------------------------------------------------------------------------------------------------------

def test_offset_and_combine_makes_cluster_ids_globally_unique():
    labels_a = pd.DataFrame({'label_id': [1, 2, 3], 'label_type': ['A', 'A', 'A'], 'cluster': [1, 1, 2]})
    clusters_a = pd.DataFrame({'label_type': ['A', 'A'], 'cluster': [1, 2],
                               'lat': [0.0, 0.0], 'lng': [0.0, 0.0], 'severity': [1, 1]})
    labels_b = pd.DataFrame({'label_id': [4, 5], 'label_type': ['B', 'B'], 'cluster': [1, 2]})
    clusters_b = pd.DataFrame({'label_type': ['B', 'B'], 'cluster': [1, 2],
                               'lat': [0.0, 0.0], 'lng': [0.0, 0.0], 'severity': [1, 1]})

    label_output, cluster_output = lc.offset_and_combine([('A', clusters_a, labels_a), ('B', clusters_b, labels_b)])

    # Type B's ids (originally 1,2) are offset past type A's highest id (2) -> 3,4. No id collisions across types.
    assert [int(c) for c in label_output['cluster']] == [1, 1, 2, 3, 4]
    assert [int(c) for c in cluster_output['cluster']] == [1, 2, 3, 4]


# --------------------------------------------------------------------------------------------------------------------
# build_output_json
# --------------------------------------------------------------------------------------------------------------------

def test_build_output_json_has_expected_shape():
    labels = pd.DataFrame({'label_id': [1], 'label_type': ['A'], 'cluster': [1]})
    clusters = pd.DataFrame({'label_type': ['A'], 'cluster': [1], 'lat': [1.0], 'lng': [2.0], 'severity': [3]})

    out = json.loads(lc.build_output_json(lc.THRESHOLDS, labels, clusters))

    assert set(out.keys()) == {'thresholds', 'labels', 'clusters'}
    assert len(out['thresholds']) == len(lc.THRESHOLDS)
    assert out['labels'][0]['label_id'] == 1
    assert out['clusters'][0]['label_type'] == 'A'


# --------------------------------------------------------------------------------------------------------------------
# I/O wrappers
# --------------------------------------------------------------------------------------------------------------------

def test_fetch_labels_normalizes_json(monkeypatch):
    class _Resp:
        def json(self):
            return [{'label_id': 1, 'lat': 47.6, 'lng': -122.3}]

    monkeypatch.delenv('INTERNAL_API_KEY', raising=False)
    monkeypatch.setattr(lc.requests, 'get', lambda url, headers, timeout: _Resp())
    df = lc.fetch_labels('http://localhost:9000/labelsToClusterInRegion?regionId=1')
    assert df.iloc[0]['label_id'] == 1


def test_post_results_posts_payload(monkeypatch):
    captured = {}

    def _fake_post(url, data, headers, timeout):
        captured.update(url=url, data=data, headers=headers)
        return 'resp'

    monkeypatch.delenv('INTERNAL_API_KEY', raising=False)
    monkeypatch.setattr(lc.requests, 'post', _fake_post)
    assert lc.post_results('http://localhost:9000/clusteringResults', '{}') == 'resp'
    assert captured['headers'] == lc.POST_HEADER


def test_auth_headers_present_only_when_env_set(monkeypatch):
    monkeypatch.delenv('INTERNAL_API_KEY', raising=False)
    assert lc._auth_headers() == {}
    monkeypatch.setenv('INTERNAL_API_KEY', 'sekret')
    assert lc._auth_headers() == {'Authorization': 'Bearer sekret'}


# --------------------------------------------------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------------------------------------------------

def _patch_io(monkeypatch, fetched):
    """Patch fetch_labels to return `fetched`, post_results to record, and the executor to run synchronously."""
    posted = {}
    monkeypatch.setattr(lc, 'fetch_labels', lambda url: fetched)
    monkeypatch.setattr(lc, 'post_results', lambda url, payload: posted.update(url=url, payload=payload))
    monkeypatch.setattr(lc, 'ProcessPoolExecutor', _SyncExecutor)
    return posted


def _multi_type_frame():
    """A realistic post-fetch frame: a clusterable pair, a singleton, and a Problem-component pair."""
    return pd.DataFrame({
        'label_id': [1, 2, 3, 4, 5],
        'label_type': ['CurbRamp', 'CurbRamp', 'NoSidewalk', 'SurfaceProblem', 'Obstacle'],
        'lat': [47.6000, 47.60003, 47.6100, 47.6200, 47.62003],
        'lng': [-122.3000, -122.3000, -122.3100, -122.3200, -122.3200],
        'user_id': [10, 20, 30, 40, 50],
        'pano_id': ['a', 'b', 'c', 'd', 'e'],
        'severity': [1.0, 2.0, 3.0, 4.0, 5.0],
    })


def test_main_no_labels_posts_empty_payload(monkeypatch):
    posted = _patch_io(monkeypatch, pd.DataFrame())
    assert lc.main(['--region_id', '1']) == 0
    assert posted['payload'] == lc.EMPTY_PAYLOAD


def test_main_all_invalid_labels_posts_empty_payload(monkeypatch):
    frame = pd.DataFrame({'label_id': [1], 'label_type': ['CurbRamp'], 'lat': [47.6], 'lng': [500.0],
                          'user_id': [10], 'pano_id': ['a'], 'severity': [1.0]})
    posted = _patch_io(monkeypatch, frame)
    assert lc.main(['--region_id', '1']) == 0
    assert posted['payload'] == lc.EMPTY_PAYLOAD


def test_main_happy_path_posts_clusters(monkeypatch):
    posted = _patch_io(monkeypatch, _multi_type_frame())
    assert lc.main(['--region_id', '1']) == 0
    out = json.loads(posted['payload'])
    assert len(out['labels']) >= 1
    assert len(out['clusters']) >= 1


def test_main_debug_with_dirty_data_still_clusters(monkeypatch, capsys):
    # Mix valid CurbRamp pair with one invalid-lng and one NaN-lng row; --debug exercises the cleaning-stats prints.
    frame = pd.DataFrame({
        'label_id': [1, 2, 3, 4],
        'label_type': ['CurbRamp', 'CurbRamp', 'CurbRamp', 'CurbRamp'],
        'lat': [47.6000, 47.60003, 47.61, 47.62],
        'lng': [-122.3000, -122.3000, 500.0, np.nan],
        'user_id': [10, 20, 30, 40],
        'pano_id': ['a', 'b', 'c', 'd'],
        'severity': [1.0, 2.0, 3.0, 4.0],
    })
    posted = _patch_io(monkeypatch, frame)
    assert lc.main(['--region_id', '1', '--debug']) == 0
    printed = capsys.readouterr().out
    assert 'invalid longitude' in printed
    assert 'NaN longitude' in printed
    assert 'N_LABELS' in printed
    assert json.loads(posted['payload'])['labels']  # still produced clusters from the 2 valid rows


def test_main_debug_with_clean_data(monkeypatch):
    # --debug path with no invalid/NaN rows, so the cleaning-stat guards take their false branch.
    posted = _patch_io(monkeypatch, _multi_type_frame())
    assert lc.main(['--region_id', '1', '--debug']) == 0
    assert json.loads(posted['payload'])['labels']


def test_main_returns_1_when_fetch_fails(monkeypatch):
    def _boom(url):
        raise requests.RequestException('connection refused')

    called = []
    monkeypatch.setattr(lc, 'fetch_labels', _boom)
    monkeypatch.setattr(lc, 'post_results', lambda url, payload: called.append(payload))
    assert lc.main(['--region_id', '1']) == 1
    assert called == []  # nothing posted on a fetch failure
