
# coding: utf-8

# __Notebook for creating a set of routes for MTurk experiments__ (@author: hmaddali@umd.edu)
#
# MTurkers who will be working on Project Sidewalk will only be exposed to a set of predefined routes. These routes will be generated from the sidewalk.street_edge table which stores an edge list representation of the google street view map.
#
# Tasks:
# 1. Connect to postgresql "sidewalk" database
# 2. Calculate the length of each edge (geodesic or euclidean).
# 3. Select N distinct random seedpoints (as starting edges for N paths).
# 4. Keep choosing the next edge using some mechanism till the continuous path_distance is approximately equal to some threshold mission_distance d_m. The mechanism for choosing the next edge can be:
#     * Random selection (Not exactly a random walk)
#     * Largest edge
#     * Edge that brings the path distance closest to d_m
#     The intention is to perform a kind of dept first search to get a continuous path that satifies our distance constraint (and in the future a constraint on the count and diversity of labels already present as ground truth on the path). If the path gets terminated before it can reach d_m length then the current edge is discarded and we start again from the previous edge. In this, I can also set the complexity of a path by the number of turns/number of intersections/length between intersections...
# 5. Something that I would like to ensure is that there is low overlap between any 2 paths. If we have some overlap between 2 paths that the same turker is labeling then he/she might remember the positions where they placed the labels previously. This leads to a learning effect (ordering effect). I can formulate this as a decision problem. We can have a function generate_routes(map,region,N,mission_distance d_m,distance_delta d_del,overlap_threshold) such that the function outputs:
#     * True if we have a set of N routes within a region on a map that satisfy the constraint of d_m-d_del<=length<=dm+d_del and no 2 routes have an overlap of more than overlap_threshold. Overlap is defined as the Jaccard distance between 2 paths (represented by sets of edges). Ideally we want overlap_threshold to be as low as possible (equal to zero).
#     * False if we cannot find N such routes. We may need to increase our overlap_threshold. We can also discard some of the generated paths (lower the value of N).
#
#     We want to implement the search problem version of this i.e. find the N routes that satisfy our constraints.
#
# 6. Place these paths in a "routes_street" dataframe (representing a directed path along the map) that has the columns:
#     1. route_id: Primary Identifier, Integer indicating which route a particular row belongs to. May have multiple edges with the same (source,target) tuple but they should belong to different predetermined routes.
#     2. source: Int id of the source node
#     3. target: Int id of the target node
#     4. street_edge_id
#     4. length: In miles
#     5. route_start_edge: Indicates if this is the starting edge of the route
#     6. route_end_edge: Indicates if this is the terminating edge of the route
#     Ideally we would like to have non-overlapping paths to avoid learning effects. However this might not be possible in practise. Two routes having a common edge will still be able to transition as expected since there is an additional route_id. So if ur current edge is common to 2 paths we transition to the currect next edge by checking (route_id,nextedge_id) instead of just (nextedge_id). (Important because of the existing way we transition between streetedges in a mission (by checking if already completed (and possibly random selection among available next edges))).
# 7. Calculate an N-by-N matrix (inefficient) of pairwise-route-overlap (Jaccard distance). Filter out the routes below an overlap_threshold.
# 8. Create "routes_street" (described above in point 6.) and "routes" table in the postgres db. The "routes" table has the following columns:
#     1. 'route_length': Total length of the routex
#     2. 'mean_street_length': Average lengths of the component street edges
#     3. 'std_street_length': Standard deviation of lengths of the component street edges
#     4. 'street_count': Number of street edges forming the route
#
#
# Note: Change database connection details where necessary. My dbserver
# was running on localhost:5000

# In[ ]:

import collections


# In[ ]:

import psycopg2
import psycopg2.extras

from sqlalchemy import create_engine

import geopy
from geopy.distance import vincenty
from geopy.distance import great_circle

import pandas as pd
import numpy as np

import matplotlib.pyplot as plt
import seaborn as sns


# Connect to the database and get the edge list representation of the map.

# In[ ]:

db_port = '5432'
try:
    conn = psycopg2.connect(
        "dbname='sidewalk' user='sidewalk' host='localhost' port=" + db_port + " password='sidewalk'")
except:
    print "I am unable to connect to the database"


# In[ ]:

engine = create_engine(
    'postgresql://sidewalk:sidewalk@localhost:' + db_port + '/sidewalk')


# In[ ]:

cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


# In[ ]:

# Query that returns all edges along with their region_id
# Note: Region_id should be from the entries that are not marked deleted
cur.execute("""SELECT t2.region_id,t1.* from sidewalk.street_edge as t1 join sidewalk.street_edge_region as t2 on t1.street_edge_id=t2.street_edge_id where t1.deleted=FALSE and t2.region_id in (197,200,279,266,284)""")


# In[ ]:

rows = cur.fetchall()


# In[ ]:

# The result of the query is stored as a list of dictionaries.
# The keys correspond to column names.
# source and target may be stored as float. Need to be converted to int.
if False:
    print rows[0]


# Calculate length of each edge using the geopy library's great_circle
# (haversine) distance function

# In[ ]:

edges = pd.DataFrame(rows)


# In[ ]:

vincenty_distance = lambda edge: vincenty(
    (edge['y1'], edge['x1']), (edge['y2'], edge['x2'])).miles
haversine_distance = lambda edge: great_circle(
    (edge['y1'], edge['x1']), (edge['y2'], edge['x2'])).miles
# Create a new columns "length"
edges["length"] = edges.apply(haversine_distance, axis=1)


# In[ ]:

# Only consider the subset of columns (csubset) that we need for path-finding.
edges_csubset = edges.filter(
    ['region_id', 'source', 'target', 'street_edge_id', 'length'])


# In[ ]:

if False:
    edges_csubset.set_index('street_edge_id', inplace=True)


# In[ ]:

if False:
    edges_csubset.to_sql('street_edge_length', engine, if_exists='replace')


# In[ ]:

if False:
    # Scatter plot of map nodes (only considering x1 and y1 from edge data)
    # You get something resembling the map of DC
    # In the future we can overlay the seed edges over all the N initial samples and have an animated visual for
    # path generation
    sns.lmplot('x1', 'y1',
               data=edges,
               fit_reg=False,
               scatter_kws={"marker": "D",
                            "s": 100})
    # Scatter plot of a small sample of the map nodes (only considering x1 and
    # y1 from edge data)
    sns.lmplot('x1', 'y1',
               data=edges.sample(n=100),
               fit_reg=False,
               scatter_kws={"marker": "D",
                            "s": 100})
    plt.title('Scatterplot of map nodes')
    plt.xlabel('lat')
    plt.ylabel('long')
    plt.show()


# In[ ]:

# Create an adjacency list representation.
# This will make it easier to find neighbours of a node for Depth-Limited Search
adjacency_list = collections.defaultdict(dict)
adjacency_list_region = collections.defaultdict(dict)
adjacency_list_streetedge = collections.defaultdict(dict)
for index, edge in edges_csubset.iterrows():
    source = edge['source']
    target = edge['target']
    # This assumes there is a single path between source and target
    # which is obviously not practical
    adjacency_list[source][target] = edge['length']
    adjacency_list[target][source] = edge['length']
    adjacency_list_region[source][target] = edge['region_id']
    adjacency_list_region[target][source] = edge['region_id']
    adjacency_list_streetedge[source][target] = edge['street_edge_id']
    adjacency_list_streetedge[target][source] = edge['street_edge_id']


# In[ ]:

# Show all the nodes connected to node 13103 with their distance
if False:
    print adjacency_list_streetedge[13103]


# In[ ]:

def find_path(seed_edge, adjacency_list, adjacency_list_region, adjacency_list_streetedge, d_m=0.19, d_del_low=0.01, d_del_high=0.0):

    # d_m is the mission distance. By default it is 0.19 miles or 1000 ft
    # d_del is the allowed deviated from the mission distance for a path in miles

    check_distance_constraint = lambda x: x <= (
        d_m + d_del_low) and x >= (d_m - d_del_high)
    check_distance_exceeded = lambda x: x >= (d_m + d_del_high)

    if(len(adjacency_list.keys()) == 0):
        path_exists = False
    else:
        path_exists = True

    path = list()
    path.append({'street_edge_id': seed_edge['street_edge_id'], 'region_id': seed_edge[
                'region_id'], 'target': seed_edge['target'], 'source': seed_edge['source'], 'length': seed_edge['length']})
    current_path_length = seed_edge['length']
    if(check_distance_constraint(current_path_length)):
        # Current path length meets our constraint
        path_exists = True
        path[-1]['next_street_edge_id'] = -1
        return (path, path_exists, current_path_length)

    current_source = seed_edge['target']
    visited_nodes = set([seed_edge['target'], seed_edge['source']])

    while(True):

        all_adjacent_nodes = set(adjacency_list[current_source].keys())
        # Apply regionionality constraint. All nodes in the path should be in the same region
        # This can also be ignored if we want do not find enough paths.
        region_adjacent_nodes = set(node for node in all_adjacent_nodes if adjacency_list_region[
                                    current_source][node] == seed_edge['region_id'])
        unvisited_adjacent_nodes = region_adjacent_nodes.difference(visited_nodes)

        if(len(unvisited_adjacent_nodes) > 0):
            # Unvisited nodes adjacent to current source
            # and path length doesnt meet our constraint.
            current_target = unvisited_adjacent_nodes.pop()
            current_edge_length = adjacency_list[current_source][current_target]
            current_street_edge_id = adjacency_list_streetedge[
                current_source][current_target]
            current_path_length = current_path_length + current_edge_length
            if(len(path) > 0):
                path[-1]['next_street_edge_id'] = current_street_edge_id

            path.append({'street_edge_id': current_street_edge_id, 'region_id': seed_edge[
                        'region_id'], 'target': current_target, 'source': current_source, 'length': current_edge_length})
            # print path
            current_source = current_target
            visited_nodes.add(current_source)

        elif(len(unvisited_adjacent_nodes) == 0):
            if(current_source == seed_edge['source']):
                # We've recursed all the way back to origin seed edge source.
                # There is no path that meets our constraints starting from this seed edge
                path_exists = False
                current_path_length = 0
                return ([{'street_edge_id': seed_edge['street_edge_id'], 'region_id':seed_edge['region_id'], 'target':seed_edge['target'], 'source':seed_edge['source'], 'length':seed_edge['length']}], path_exists, seed_edge['length'])
            else:
                # No unvisited nodes adjacent to current source
                # and path length doesnt meet our constraint.
                # Try going back to the previous source and try another edge.
                previous_edge = path.pop()
                # print path
                current_source = previous_edge['source']  # update current_source
                current_path_length = current_path_length - \
                    previous_edge['length']  # update current_path_length

        else:
            print "Error. Number of unvisited nodes is -ve!!"

        if(check_distance_constraint(current_path_length)):
            # Current path length meets our constraint
            path[-1]['next_street_edge_id'] = -1
            return (path, path_exists, current_path_length)
        elif(not check_distance_exceeded(current_path_length)):
            continue
        else:
            # path length exceeds constraint
            # print "Current Path Length",current_path_length
            # print "Current Path",path
            previous_edge = path.pop()
            current_source = previous_edge['source']  # update current_source
            current_path_length = current_path_length - \
                previous_edge['length']  # update current_path_length


# In[ ]:

# Example: Find a path of around 1 mile in length with the given seed edge
# We can dynamically vary d_del to get the path that has the least
# deviation from the mission distance
if False:
    print adjacency_list_streetedge[13103][13077]
    print find_path({'street_edge_id': 11326, 'source': 13103, 'target': 13077, 'length': 0.10199468383820903, 'region_id': 219}, adjacency_list, adjacency_list_region, adjacency_list_streetedge, d_m=1.0, d_del_high=0.04)


# Generate a random sample of N unique starting edges and find N paths
# that satisfy the distance constraint

# In[ ]:

N = 1000  # Probability of getting 1 +/- 0.01 mi paths was found to be around 0.4 for N=1000 on 1 trial
edges_sample = edges_csubset.sample(N, replace=True)


# In[ ]:

# There is a non-negligible probability that a path under such constraints cant be found.
# We can probably sample d_del_high and d_del_low such that most of the seed edges generate valid routes
# Weed out invalid route (doesn't meet distance constraint) generating seed edges

valid_paths = list()
valid_path_count = 0
for index, seed_edge in edges_sample.iterrows():
    path, path_exists, path_length = find_path(
        seed_edge, adjacency_list, adjacency_list_region, adjacency_list_streetedge, d_del_low=0.01, d_del_high=0.01)
    if(path_exists):
        # Add a route_id, and route_start_edge,route_end_edge boolean indicators
        # to each edge in the valid path
        for k in range(len(path)):
            path[k]['route_id'] = index
            if(k == 0):
                # This indicates that the route should start at this edge
                path[k]['route_start_edge'] = True
            else:
                # This indicates that the route should end at this edge
                path[k]['route_start_edge'] = False

            if(k == len(path) - 1):
                path[k]['route_end_edge'] = True
            else:
                path[k]['route_end_edge'] = False

        valid_paths.append(path)
        # print path_df
        valid_path_count = valid_path_count + 1

print "Number of valid paths generated: ", valid_path_count


# Calculate the Jaccard distance matrix between the paths and apply the
# overlap_threshold constraint to weed out some of these paths. Ultimately
# we want some K number of paths that satisfy both the distance and
# pairwise overlap constraints.

# In[ ]:

def jaccard_similarity(path_x, path_y):
    if(not path_x[0]['region_id'] == path_y[0]['region_id']):
        # Assuming that streetedges are not present in multiple regions.
        # Paths belonging to different regions will then not have common edges.
        return 0.0
    else:
        set_x = set((int(edge['source']), int(edge['target'])) for edge in path_x)
        set_y = set((int(edge['source']), int(edge['target'])) for edge in path_y)
        return len(set_x.intersection(set_y)) / float(len(set_x.union(set_y)))


# In[ ]:

if True:
    overlap_threshold = 0.2
    overlap_constraint = lambda similarity, overlap_threshold: similarity >= 0.0 and similarity <= overlap_threshold
    valid_pair_count = 0
    invalid_path_indices = set()
    for i in range(len(valid_paths)):
        for j in range(i + 1, len(valid_paths)):
            similarity = jaccard_similarity(valid_paths[i], valid_paths[j])
            if(not overlap_constraint(similarity, overlap_threshold)):
                # Prints the indices of the pairs of paths that overlap "too much".
                # This is set by the overlap_threshold
                invalid_path_indices.add(i)
                invalid_path_indices.add(j)
                #print (similarity,i,j)
            else:
                valid_pair_count = valid_pair_count + 1

# print "Pairs satisfying overlap constrained",valid_pair_count

# I'm considering removing both paths from an invalid pair but I should just remove one of them
# Oh well, as long as I can work with a huge N to begin with I dont care.
# The final number of valid paths should be atleast some K
# For the class MTurk project it is K=30

num_valid = len(valid_paths) - len(invalid_path_indices)
num_invalid = len(invalid_path_indices)
overall_percentage_valid = float(num_valid) * 100 / N

print "Number of valid paths", num_valid
print "Number of invalid paths", num_invalid
print "Percentage of seed edges that have generated paths obeying the distance, regionality and overlap constrains: ",
print overall_percentage_valid, "%"
# print "Invalid path indices", invalid_path_indices
# Should have weeded out a lot of paths


# In[ ]:

# Delete invalid paths
for index in sorted(invalid_path_indices, reverse=True):
    del valid_paths[index]


# In[ ]:

if False:
    print valid_paths[0]


# In[ ]:

# Assuming I only want K routes in the end
# I can randomly sample K times from the valid_paths list or just select the top 50
# Or I can sample based on regions. I want more paths from certain regions
# Or paths with more unexplored street edges
K = 30
appended_data = []
for path in valid_paths[0:min(K, len(valid_paths))]:
    path_df = pd.DataFrame(path)
    appended_data.append(path_df)  # store dataframes in list

# Route table has K routes (identified by route id)
route_street_table = pd.concat(appended_data)
route_street_table.reset_index(drop=True, inplace=True)

for column in ['route_id', 'region_id', 'source', 'target', 'street_edge_id', 'next_street_edge_id']:
    route_street_table[column] = route_street_table[column].astype(int)


# In[ ]:

route_street_table.index.names = ['route_street_id']


# In[ ]:

change_column_names = {'street_edge_id': 'current_street_edge_id', 'length': 'length_mi'}
delete_column_names = ['source', 'target']


# Check if the length of the routes are within the range that we expect

# In[ ]:

route_table = route_street_table.groupby(['route_id', 'region_id'])['length'].agg(
    {'street_count': len, 'route_length_mi': np.sum, 'mean_street_length_mi': np.mean, 'std_street_length_mi': np.std})
route_table['street_count'] = route_table['street_count'].astype(int)

# Change some column names before creating the tables
for column in change_column_names:
    route_street_table[change_column_names[column]] = route_street_table[column]
    del route_street_table[column]
# Delete some columns
for column in delete_column_names:
    del route_street_table[column]


# Write route_table and route_street_table to postgres sidewalk database

# In[ ]:
route_table.to_sql('route', engine, if_exists='append')
route_street_table.to_sql('route_street', engine, if_exists='append', index=True)
