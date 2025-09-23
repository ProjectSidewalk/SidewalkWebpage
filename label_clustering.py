import os
import numpy as np
import pandas as pd
from haversine import haversine
import sys
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import pdist
import argparse
import requests
import json
# from pandas.io.json import json_normalize
from concurrent.futures import ProcessPoolExecutor

# For each label type, cluster based on haversine distance.
def cluster(labels, curr_type, thresholds):

    # Computes the distance matrix between all points using haversine distance.
    dist_matrix = pdist(np.array(labels[['lat', 'lng']].values), lambda x, y: haversine(x, y))
    link = linkage(dist_matrix, method='complete')

    # Copies the labels dataframe and adds a column to it for the cluster id each label is in.
    labelsCopy = labels.copy()
    labelsCopy.loc[:,'cluster'] = fcluster(link, t=thresholds[curr_type], criterion='distance')

    # Cuts tree so that only labels less than clust_thresh kilometers apart are clustered.
    clusters = labelsCopy.groupby('cluster')

    # Computes the center and median severity of each cluster.
    cluster_df = pd.DataFrame(columns=cluster_cols) # DataFrame with cols (label_type, cluster_num, lat, lng, severity).
    for clust_num, clust in clusters:
        cluster_centroid = np.mean(clust['coords'].tolist(), axis=0) # use ave pos of clusters.
        median_severity = None if pd.isnull(clust['severity']).all() else int(round(np.median(clust['severity'][~np.isnan(clust['severity'])])))
        cluster_df = pd.concat([cluster_df, pd.DataFrame(columns=cluster_cols, data=[[curr_type, clust_num, cluster_centroid[0], cluster_centroid[1], median_severity]])])

    return (cluster_df, labelsCopy)



if __name__ == '__main__':

    N_PROCESSORS = 8
    POST_HEADER = {'content-type': 'application/json; charset=utf-8'}
    PORT = os.environ.get('SIDEWALK_HTTP_PORT', '9000')

    # Read in arguments from command line.
    parser = argparse.ArgumentParser(description='Gets a set of labels, posts the labels grouped into clusters.')
    parser.add_argument('--key', type=str,
                        help='Key string that is used to authenticate when using API.')
    parser.add_argument('--region_id', type=int,
                        help='Region id of a region who\'s labels should be clustered.')
    parser.add_argument('--debug', action='store_true',
                        help='Debug mode adds print statements')
    args = parser.parse_args()
    KEY = args.key
    DEBUG = args.debug
    REGION_ID = args.region_id
    GET_URL = 'http://localhost:' + PORT +'/labelsToClusterInRegion?key=' + KEY + '&regionId=' + str(REGION_ID)
    POST_URL = 'http://localhost:' + PORT +'/clusteringResults?key=' + KEY + '&regionId=' + str(REGION_ID)


    # Send GET request to get the labels to be clustered.
    try:
        response = requests.get(GET_URL)
        data = response.json()
        label_data = pd.json_normalize(data)
        # print label_data
    except:
        print("Failed to get labels needed to cluster.")
        sys.exit()

    # Define thresholds clustering (numbers are in kilometers).
    thresholds = {'CurbRamp': 0.0075,
                  'NoCurbRamp': 0.0075,
                  'SurfaceProblem': 0.01,
                  'Obstacle': 0.01,
                  'NoSidewalk': 0.01,
                  'Crosswalk': 0.01,
                  'Signal': 0.01,
                  'Occlusion': 0.01,
                  'Other': 0.01,
                  'Problem': 0.01}

    # Pick which label types should be included in clustering, and which should be included in the "Problem" type.
    label_types = ['CurbRamp', 'NoSidewalk', 'Problem', 'Occlusion', 'SurfaceProblem', 'Obstacle', 'Other', 'NoCurbRamp', 'Crosswalk', 'Signal']
    problem_types = ['SurfaceProblem', 'Obstacle', 'NoCurbRamp']

    # These are the columns required in the POST requests for the labels and clusters, respectively.
    label_cols = ['label_id', 'label_type', 'cluster']
    cluster_cols = ['label_type', 'cluster', 'lat', 'lng', 'severity']

    # Check if there are 0 labels. If so, just send the post request and exit.
    if len(label_data) == 0:
        response = requests.post(POST_URL, data=json.dumps({'thresholds': [], 'labels': [], 'clusters': []}), headers=POST_HEADER)
        sys.exit()

    # Remove weird entries with latitude and longitude values (on the order of 10^14).
    if sum(label_data.lng > 360) > 0:
        if DEBUG: print('There are %d invalid longitude vals, removing those entries.' % sum(label_data.lng > 360))
        label_data = label_data.drop(label_data[label_data.lng > 360].index)
    if sum(pd.isnull(label_data.lng)) > 0:
        if DEBUG: print('There are %d NaN longitude vals, removing those entries.' % sum(pd.isnull(label_data.lng)))
        label_data = label_data.drop(label_data[pd.isnull(label_data.lng)].index)

    # Check if there are 0 labels left after removing those with errors. If so, just send the post request and exit.
    if len(label_data) == 0:
        response = requests.post(POST_URL, data=json.dumps({'thresholds': [], 'labels': [], 'clusters': []}), headers=POST_HEADER)
        sys.exit()

    # Put lat-lng in a tuple so it plays nice w/ haversine function.
    label_data['coords'] = label_data.apply(lambda x: (x.lat, x.lng), axis = 1)
    label_data['id'] =  label_data.index.values

    # Performs clustering on the data for a single label type; namely, the type at position i in the label_types array.
    def cluster_label_type_at_index(i):
        clusters_for_type_i = pd.DataFrame(columns=cluster_cols)
        labels_for_type_i = pd.DataFrame(columns=label_cols)

        label_type = label_types[i]
        if label_type == 'Problem':
            type_data = label_data[label_data.label_type.isin(problem_types)]
        else:
            type_data = label_data[label_data.label_type == label_type]

        # If there are >1 labels, we can do clustering. Otherwise just copy the 1 (or 0) labels.
        if type_data.shape[0] > 1:
            (clusters_for_type_i, labels_for_type_i) = cluster(type_data, label_type, thresholds)
        elif type_data.shape[0] == 1:
            labels_for_type_i = type_data.copy()
            labels_for_type_i.loc[:,'cluster'] = 1 # Gives the single cluster a cluster_id of 1.
            labels_for_type_i.loc[:,'label_type'] = label_type # Gives Problem type if needed.
            clusters_for_type_i = labels_for_type_i.filter(items=cluster_cols)

        return (label_type, clusters_for_type_i, labels_for_type_i)

    # Calls `func` len(`args`) times, with `workers` number of threads. Used to compute diff label type in parallel.
    def multiprocessing(func, args, workers):
        with ProcessPoolExecutor(max_workers=workers) as executor:
            res = executor.map(func, args)
        return list(res)

    # Calls the clustering function via the multiprocessing function.
    clust_results_by_label_type = multiprocessing(cluster_label_type_at_index, range(0, len(label_types)), N_PROCESSORS)

    # Clustering results were done individually for each label type, so their cluster_ids start at 1 for each type. So
    # now we offset the cluster ids for different label types so they are unique, and combine the lists.
    label_output = pd.DataFrame(columns=label_cols)
    cluster_output = pd.DataFrame(columns=cluster_cols)
    clusterOffset = 0
    for i in range(0, len(label_types)):
        (label_type, clusters_for_type_i, labels_for_type_i) = clust_results_by_label_type[i]
        if not label_output.empty:
            clusterOffset = np.max(label_output.cluster)

        clusters_for_type_i.cluster += clusterOffset
        cluster_output = pd.concat([cluster_output, pd.DataFrame(clusters_for_type_i.filter(items=cluster_cols))])

        labels_for_type_i.cluster += clusterOffset
        label_output = pd.concat([label_output, pd.DataFrame(labels_for_type_i.filter(items=label_cols))])

    if DEBUG:
        print("LABEL_TYPE: N_LABELS -> N_CLUSTERS")
        print("----------------------------------")
        for label_type in label_types:
            print(str(label_type) + ": " + \
                  str(label_output[label_output.label_type == label_type].cluster.nunique()) + \
                  " -> " + str(cluster_output[cluster_output.label_type == label_type].cluster.nunique()))

    # Convert to JSON.
    cluster_json = cluster_output.to_json(orient='records')
    label_json = label_output.to_json(orient='records')
    threshold_json = pd.DataFrame({'label_type': thresholds.keys(),
                                   'threshold': thresholds.values()}).to_json(orient='records')
    output_json = json.dumps({'thresholds': json.loads(threshold_json),
                              'labels': json.loads(label_json),
                              'clusters': json.loads(cluster_json)})
    # print output_json
    # print 'chars in json: ' + str(len(output_json))

    # POST results.
    response = requests.post(POST_URL, data=output_json, headers=POST_HEADER)
    sys.exit()
