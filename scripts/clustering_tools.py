# Derived from first link, which is derived from second link.
# https://github.com/crescendochu/ML-project-sidewalk/blob/main/seattle/clustering-notebooks/clustering_q1.ipynb
# https://github.com/ProjectSidewalk/SidewalkWebpage/blob/develop/label_clustering.py

import sys
import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import pdist
from haversine import haversine


def custom_dist(u, v):
    if u[2] == v[2]:
        return sys.float_info.max
    else:
        return haversine([u[0], u[1]], [v[0], v[1]])


THRESHOLDS = {'CurbRamp': 0.0035,
              'NoCurbRamp': 0.0035,
              'SurfaceProblem': 0.01,
              'Obstacle': 0.01,
              'NoSidewalk': 0.01,
              'Crosswalk': 0.01,
              'Signal': 0.01,
              'Occlusion': 0.01,
              'Other': 0.01}
LABEL_COLS = ['labelId', 'clusterId']
CLUSTER_COLS = ['clusterId']


def cluster(labels, label_type):
    labelsCopy = labels.copy()

    # If there is only 1 label, just copy the that label and skip the clustering.
    if labels.shape[0] == 1:
        labelsCopy.loc[:, 'clusterId'] = 1  # Gives the single cluster a clusterId of 1.
        trivial_clusters = labelsCopy.filter(items=CLUSTER_COLS)
        return trivial_clusters, labelsCopy

    # Makes a normal dist matrix for a single user, but uses special dist function for multi-user clustering that
    # prevents the same user's attributes from being clustered together.
    dist_matrix = pdist(np.array(labels[['lat', 'lng', 'userId']].values), custom_dist)
    link = linkage(dist_matrix, method='complete')

    # Copies the labels dataframe and adds a column to it for the cluster id each label is in.
    labelsCopy.loc[:,'clusterId'] = fcluster(link, t=THRESHOLDS[label_type], criterion='distance')

    # Cuts tree so that only labels less than clust_thresh kilometers apart are clustered.
    clusters = labelsCopy.groupby('clusterId')

    # Computes the center of each cluster.
    cluster_list = []  # list of tuples (cluster_num).
    for clust_num, clust in clusters:
        cluster_list.append(clust_num)

    cluster_df = pd.DataFrame(cluster_list, columns=['clusterId'])

    return cluster_df, labelsCopy
