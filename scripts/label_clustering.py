"""
Clusters a region's accessibility labels by type and posts the results back to the app.

This script is invoked in-band, once per region, by ``ClusterService.runMultiUserClustering`` (see
``app/service/ClusterService.scala``) when an admin triggers ``/runClustering``. It:

  1. GETs the region's labels from ``/labelsToClusterInRegion``.
  2. Drops labels with invalid/missing coordinates.
  3. Clusters each label type independently with complete-linkage hierarchical clustering over haversine distance,
     using a per-type distance threshold. Labels from the same (user, pano) are never clustered together.
  4. Offsets the per-type cluster ids so they are globally unique, then POSTs the labels, clusters, and thresholds
     back to ``/clusteringResults``.

Run directly (matching the Scala invocation, from the repo root):

    python3 scripts/label_clustering.py --key <internal-api-key> --region_id <id> [--debug]

The HTTP port defaults to 9000 and can be overridden with the ``SIDEWALK_HTTP_PORT`` environment variable.

The pure functions here (``custom_dist``, ``clean_label_data``, ``cluster``, ``cluster_label_type``,
``offset_and_combine``, ``build_output_json``) are import-safe and unit-tested in
``test/python/test_label_clustering.py``; the network I/O lives in thin wrappers and ``main`` so it can be excluded
from tests.
"""

import argparse
import functools
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd
import requests
from haversine import haversine
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import pdist

# Number of worker processes used to cluster the label types in parallel.
N_PROCESSORS = 8

# Seconds before a GET/POST to the app is abandoned. Generous because a region can hold many labels, but bounded so a
# hung app can never wedge the clustering run indefinitely.
REQUEST_TIMEOUT = 120

POST_HEADER = {'content-type': 'application/json; charset=utf-8'}

# Per-label-type clustering distance thresholds, in kilometers. Two labels closer than the threshold (and not from the
# same user+pano) are eligible to be clustered together. CurbRamp/NoCurbRamp use a tighter radius than the rest.
THRESHOLDS = {
    'CurbRamp': 0.0075,
    'NoCurbRamp': 0.0075,
    'SurfaceProblem': 0.01,
    'Obstacle': 0.01,
    'NoSidewalk': 0.01,
    'Crosswalk': 0.01,
    'Signal': 0.01,
    'Occlusion': 0.01,
    'Other': 0.01,
    'Problem': 0.01,
}

# Label types to cluster. 'Problem' is a synthetic type aggregating the PROBLEM_TYPES below.
LABEL_TYPES = ['CurbRamp', 'NoSidewalk', 'Problem', 'Occlusion', 'SurfaceProblem', 'Obstacle', 'Other', 'NoCurbRamp',
               'Crosswalk', 'Signal']

# The label types that are additionally clustered together under the synthetic 'Problem' type.
PROBLEM_TYPES = ['SurfaceProblem', 'Obstacle', 'NoCurbRamp']

# Columns required in the POST payload for labels and clusters, respectively.
LABEL_COLS = ['label_id', 'label_type', 'cluster']
CLUSTER_COLS = ['label_type', 'cluster', 'lat', 'lng', 'severity']

# Payload posted back when there is nothing to cluster (no labels, or none left after cleaning).
EMPTY_PAYLOAD = json.dumps({'thresholds': [], 'labels': [], 'clusters': []})


def custom_dist(u, v):
    """
    Distance between two labels for clustering.

    Returns the maximum float (so the two are never clustered) when both labels come from the same user and the same
    pano; otherwise returns the haversine distance between their lat/lng. This keeps a single user's repeated labels on
    one pano from collapsing into a single cluster.

    Args:
        u: Array-like ``[lat, lng, user_id, pano_id]`` for the first label.
        v: Array-like ``[lat, lng, user_id, pano_id]`` for the second label.

    Returns:
        ``sys.float_info.max`` if same user and pano, else the haversine distance in kilometers.
    """
    if u[2] == v[2] and u[3] == v[3]:  # Same user and pano id.
        return sys.float_info.max
    return haversine([u[0], u[1]], [v[0], v[1]])


def clean_label_data(label_data):
    """
    Drops labels with unusable longitudes.

    Removes rows whose longitude is greater than 360 (corrupt values on the order of 10^14 have been observed) or NaN.

    Args:
        label_data: DataFrame of labels with at least a ``lng`` column.

    Returns:
        A new DataFrame with the offending rows removed.
    """
    if sum(label_data.lng > 360) > 0:
        label_data = label_data.drop(label_data[label_data.lng > 360].index)
    if sum(pd.isnull(label_data.lng)) > 0:
        label_data = label_data.drop(label_data[pd.isnull(label_data.lng)].index)
    return label_data


def cluster(labels, curr_type, thresholds, cluster_cols=CLUSTER_COLS):
    """
    Clusters the labels of a single type by haversine distance.

    Builds a condensed distance matrix with ``custom_dist``, runs complete-linkage hierarchical clustering, and cuts the
    tree at this type's distance threshold. Each resulting cluster is summarized by the mean lat/lng of its members and
    their median severity.

    Args:
        labels:       DataFrame of one label type, with ``lat``, ``lng``, ``user_id``, ``pano_id``, ``severity``, and a
                      ``coords`` column holding ``(lat, lng)`` tuples. Must contain at least two rows.
        curr_type:    Label type name, used to look up the threshold and to tag the cluster rows.
        thresholds:   Mapping of label type -> distance threshold in kilometers.
        cluster_cols: Column order for the returned cluster summary DataFrame.

    Returns:
        A tuple ``(cluster_df, labeled)`` where ``cluster_df`` has one summary row per cluster (columns
        ``cluster_cols``) and ``labeled`` is a copy of ``labels`` with an added ``cluster`` column.
    """
    dist_matrix = pdist(np.array(labels[['lat', 'lng', 'user_id', 'pano_id']].values), custom_dist)
    link = linkage(dist_matrix, method='complete')

    labeled = labels.copy()
    labeled.loc[:, 'cluster'] = fcluster(link, t=thresholds[curr_type], criterion='distance')

    rows = []
    for clust_num, clust in labeled.groupby('cluster'):
        centroid = np.mean(clust['coords'].tolist(), axis=0)  # Average position of the cluster's members.
        if pd.isnull(clust['severity']).all():
            median_severity = None
        else:
            median_severity = int(round(np.median(clust['severity'][~np.isnan(clust['severity'])])))
        rows.append([curr_type, clust_num, centroid[0], centroid[1], median_severity])

    cluster_df = pd.DataFrame(columns=cluster_cols, data=rows)
    return cluster_df, labeled


def cluster_label_type(label_type, label_data, thresholds, label_cols=LABEL_COLS, cluster_cols=CLUSTER_COLS):
    """
    Selects the rows for one label type and clusters them.

    For the synthetic ``'Problem'`` type, selects all PROBLEM_TYPES rows; otherwise selects the matching type. With more
    than one label it delegates to ``cluster``; with exactly one it forms a single trivial cluster; with none it returns
    empty frames.

    Args:
        label_type:   The label type (or ``'Problem'``) to cluster.
        label_data:   DataFrame of all of the region's cleaned labels (must include a ``coords`` column).
        thresholds:   Mapping of label type -> distance threshold in kilometers.
        label_cols:   Column order for the per-label output frame.
        cluster_cols: Column order for the per-cluster output frame.

    Returns:
        A tuple ``(label_type, clusters_for_type, labels_for_type)``. The cluster ids start at 1 within this type and are
        made globally unique later by ``offset_and_combine``.
    """
    clusters_for_type = pd.DataFrame(columns=cluster_cols)
    labels_for_type = pd.DataFrame(columns=label_cols)

    if label_type == 'Problem':
        type_data = label_data[label_data.label_type.isin(PROBLEM_TYPES)]
    else:
        type_data = label_data[label_data.label_type == label_type]

    if type_data.shape[0] > 1:
        clusters_for_type, labels_for_type = cluster(type_data, label_type, thresholds, cluster_cols)
    elif type_data.shape[0] == 1:
        labels_for_type = type_data.copy()
        labels_for_type.loc[:, 'cluster'] = 1  # The single label is its own cluster.
        labels_for_type.loc[:, 'label_type'] = label_type  # Re-tag as 'Problem' when needed.
        clusters_for_type = labels_for_type.filter(items=cluster_cols)

    return label_type, clusters_for_type, labels_for_type


def offset_and_combine(results, label_cols=LABEL_COLS, cluster_cols=CLUSTER_COLS):
    """
    Merges per-type clustering results into single label and cluster frames with globally unique cluster ids.

    Each type's cluster ids start at 1, so before concatenating, every type's ids are offset past the highest id seen so
    far.

    Args:
        results:      Ordered iterable of ``(label_type, clusters_for_type, labels_for_type)`` tuples.
        label_cols:   Column order for the combined per-label frame.
        cluster_cols: Column order for the combined per-cluster frame.

    Returns:
        A tuple ``(label_output, cluster_output)`` of the combined frames.
    """
    label_output = pd.DataFrame(columns=label_cols)
    cluster_output = pd.DataFrame(columns=cluster_cols)

    cluster_offset = 0
    for _label_type, clusters_for_type, labels_for_type in results:
        if not label_output.empty:
            cluster_offset = np.max(label_output.cluster)

        clusters_for_type = clusters_for_type.copy()
        clusters_for_type.cluster += cluster_offset
        cluster_output = pd.concat([cluster_output, clusters_for_type.filter(items=cluster_cols)])

        labels_for_type = labels_for_type.copy()
        labels_for_type.cluster += cluster_offset
        label_output = pd.concat([label_output, labels_for_type.filter(items=label_cols)])

    return label_output, cluster_output


def build_output_json(thresholds, label_output, cluster_output):
    """
    Serializes the clustering results into the JSON body expected by ``/clusteringResults``.

    Args:
        thresholds:     Mapping of label type -> distance threshold in kilometers.
        label_output:   Combined per-label DataFrame.
        cluster_output: Combined per-cluster DataFrame.

    Returns:
        A JSON string with ``thresholds``, ``labels``, and ``clusters`` arrays.
    """
    cluster_json = cluster_output.to_json(orient='records')
    label_json = label_output.to_json(orient='records')
    threshold_json = pd.DataFrame({'label_type': list(thresholds.keys()),
                                   'threshold': list(thresholds.values())}).to_json(orient='records')
    return json.dumps({'thresholds': json.loads(threshold_json),
                       'labels': json.loads(label_json),
                       'clusters': json.loads(cluster_json)})


def fetch_labels(url):
    """
    GETs the labels to cluster and normalizes them into a DataFrame.

    Args:
        url: The ``/labelsToClusterInRegion`` URL (including key and regionId query params).

    Returns:
        A DataFrame of the region's labels (possibly empty).
    """
    response = requests.get(url, timeout=REQUEST_TIMEOUT)
    return pd.json_normalize(response.json())


def post_results(url, payload):
    """
    POSTs a JSON payload to ``/clusteringResults``.

    Args:
        url:     The ``/clusteringResults`` URL (including key and regionId query params).
        payload: The JSON string body to post.

    Returns:
        The ``requests.Response``.
    """
    return requests.post(url, data=payload, headers=POST_HEADER, timeout=REQUEST_TIMEOUT)


def main(argv=None):
    """
    Parses arguments, fetches labels, clusters them by type, and posts the results.

    Args:
        argv: Optional argument list (defaults to ``sys.argv``); accepted to make the entrypoint testable.

    Returns:
        Process exit code: 0 on success, 1 if the labels could not be fetched.
    """
    parser = argparse.ArgumentParser(description='Gets a set of labels, posts the labels grouped into clusters.')
    parser.add_argument('--key', type=str, help='Key string used to authenticate with the API.')
    parser.add_argument('--region_id', type=int, help="Region id whose labels should be clustered.")
    parser.add_argument('--debug', action='store_true', help='Print per-type cluster counts and cleaning stats.')
    args = parser.parse_args(argv)

    port = os.environ.get('SIDEWALK_HTTP_PORT', '9000')
    get_url = f'http://localhost:{port}/labelsToClusterInRegion?key={args.key}&regionId={args.region_id}'
    post_url = f'http://localhost:{port}/clusteringResults?key={args.key}&regionId={args.region_id}'

    try:
        label_data = fetch_labels(get_url)
    except requests.RequestException:
        print("Failed to get labels needed to cluster.")
        return 1

    # Nothing to cluster: still post an empty result so the app clears any stale clusters for this region.
    if len(label_data) == 0:
        post_results(post_url, EMPTY_PAYLOAD)
        return 0

    if args.debug:
        n_invalid = int(sum(label_data.lng > 360))
        if n_invalid:
            print('There are %d invalid longitude vals, removing those entries.' % n_invalid)
        n_nan = int(sum(pd.isnull(label_data.lng)))
        if n_nan:
            print('There are %d NaN longitude vals, removing those entries.' % n_nan)
    label_data = clean_label_data(label_data)

    if len(label_data) == 0:
        post_results(post_url, EMPTY_PAYLOAD)
        return 0

    # Put lat-lng in a tuple column so it plays nicely with the haversine-based centroid math.
    label_data['coords'] = label_data.apply(lambda row: (row.lat, row.lng), axis=1)

    # Cluster each label type in its own process. Each gets a copy of the region's labels and clusters independently.
    worker = functools.partial(cluster_label_type, label_data=label_data, thresholds=THRESHOLDS)
    with ProcessPoolExecutor(max_workers=N_PROCESSORS) as executor:
        results = list(executor.map(worker, LABEL_TYPES))

    label_output, cluster_output = offset_and_combine(results)

    if args.debug:
        print("LABEL_TYPE: N_LABELS -> N_CLUSTERS")
        print("----------------------------------")
        for label_type in LABEL_TYPES:
            print(str(label_type) + ": " +
                  str(label_output[label_output.label_type == label_type].cluster.nunique()) +
                  " -> " + str(cluster_output[cluster_output.label_type == label_type].cluster.nunique()))

    post_results(post_url, build_output_json(THRESHOLDS, label_output, cluster_output))
    return 0


if __name__ == '__main__':
    sys.exit(main())
