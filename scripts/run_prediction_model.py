import onnxruntime as rt
import numpy as np
import argparse
import geopandas as gpd
from shapely.geometry import Point
import clustering_tools

# TODO add sidewalk geometry
# TODO add way type
# TODO split into smaller functions

def preprocess_model_input (severity, zoom, tag, tag_count, description, clustered, cluster_count, sidewalk_distance, intersection_distance, way_type):

    data = [severity, zoom, clustered, cluster_count, sidewalk_distance, tag, description, tag_count, intersection_distance]
    if DEBUG:
        print(data)

    if way_type == '-1':
        data += [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    elif way_type == 'busway':
        data += [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    elif way_type == 'crossing':
        data += [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    elif way_type == 'living_street':
        data += [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    elif way_type == 'primary':
        data += [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    elif way_type == 'primary_link':
        data += [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]
    elif way_type == 'residential':
        data += [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]
    elif way_type == 'secondary':
        data += [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]
    elif way_type == 'secondary_link':
        data += [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
    elif way_type == 'tertiary':
        data += [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]
    elif way_type == 'tertiary_link':
        data += [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
    elif way_type == 'trunk':
        data += [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]
    elif way_type == 'trunk_link':
        data += [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]
    elif way_type == 'unclassified':
        data += [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]
    if DEBUG:
        print(data)

    input_array = np.array(data, dtype=np.float32)
    if DEBUG:
        print(input_array)
    input_array = input_array.reshape((1, input_array.shape[0]))
    if DEBUG:
        print(input_array)
    
    # Return the array
    return input_array

def predict_model_seattle(session, model_input_name, model_output_name, model_input):
    # Run model

    output = session.run([model_output_name], {model_input_name: model_input})
    predictions = output[0]

    return predictions


# Read in arguments from command line.
parser = argparse.ArgumentParser(description='Predicts whether the given metadata corresponds to a correct label.')
parser.add_argument('--label_type', type=str,
                    help='The label type for the label in Project Sidewalk.')
parser.add_argument('--zoom', type=int,
                    help='The user\'s zoom level when they placed the label.')
parser.add_argument('--severity', type=int,
                    help='The severity rating given for the label.')
parser.add_argument('--has_description', action='store_true',
                    help='The user added a freeform description.')
parser.add_argument('--no_description', action='store_false', dest='has_description',
                    help='The user DID NOT add a freeform description.')
parser.set_defaults(has_description=None)
parser.add_argument('--tag_count', type=int,
                    help='The number of tags the user applied to the label.')
parser.add_argument('--lat', type=float,
                    help='The estimated latitude for the label.')
parser.add_argument('--lng', type=float,
                    help='The estimated longitude for the label.')
parser.add_argument('--debug', action='store_true',
                    help='Debug mode adds print statements')
args = parser.parse_args()
arg_label_type = args.label_type
arg_zoom = args.zoom
arg_severity = args.severity
arg_has_description = args.has_description
arg_tag_count = args.tag_count
arg_lat = args.lat
arg_lng = args.lng
DEBUG = args.debug

if DEBUG:
    print(arg_label_type)
    print(arg_zoom)
    print(arg_severity)
    print(arg_has_description)
    print(arg_tag_count)
    print(arg_lat)
    print(arg_lng)

# Read and clean the test set of labels to use for clustering.
# TODO maybe switch clustering to EPSG:2285
labels_to_cluster = gpd.read_file('scripts/prediction-model-data/labels-route-4.shp')
labels_to_cluster = labels_to_cluster[labels_to_cluster['labelType'] == arg_label_type]
labels_to_cluster['lat'] = labels_to_cluster['geometry'].y
labels_to_cluster['lng'] = labels_to_cluster['geometry'].x
labels_to_cluster = labels_to_cluster.drop('geometry', axis=1)

# Add the new label to the dataframe.
labels_to_cluster = labels_to_cluster.append({'labelId': -1, 'labelType': arg_label_type, 'userId': '-1', 'lat': arg_lat, 'lng': arg_lng}, ignore_index=True)

# Cluster this label with the other labels on the test route.
clustered_labels = clustering_tools.cluster(labels_to_cluster, 'CurbRamp')[1]

# Count the number of labels in the cluster for the input label.
cluster_id = clustered_labels[clustered_labels['labelId'] == -1]['clusterId'].values[0]
cluster_count = clustered_labels[clustered_labels['clusterId'] == cluster_id].shape[0]

# Read in the road network data. We've already removed streets with the wrong way_types and split at intersections.
roads = gpd.read_file('scripts/prediction-model-data/streets-route-4-split.shp').to_crs('EPSG:2285')

# Find list of intersections by taking all endpoints of streets; any points present in >=3 streets are intersections.
endpoints = roads['geometry'].apply(lambda x: x.coords[0]).append(roads['geometry'].apply(lambda x: x.coords[-1]))
intersections = endpoints.value_counts()[endpoints.value_counts() >= 3] \
    .index.to_series().apply(lambda p: Point(p)) \
    .to_frame(name='geometry')
intersections_df = gpd.GeoDataFrame(intersections).set_crs('EPSG:2285')

# Get distance to nearest intersection for the given point.
input_point = gpd.GeoDataFrame({'geometry': [Point(arg_lng, arg_lat)]}).set_crs('EPSG:4326').to_crs('EPSG:2285').loc[0, 'geometry']
dist_to_intersection = intersections_df['geometry'].distance(input_point).min()
# dist_to_intersection = input_point.sjoin_nearest(intersections_df, distance_col='distance').loc[0, 'distance']

if DEBUG:
    print(f"Intersection distance: {dist_to_intersection} feet")
    print(f"Cluster count: {cluster_count}")

# Load the ONNX model
onnx_path = "scripts/prediction-model-data/predictionModel.onnx"
session = rt.InferenceSession(onnx_path)

model_input_name = session.get_inputs()[0].name
model_output_name = session.get_outputs()[0].name

# Test - example input data
severity = arg_severity if arg_severity else 0
zoom = arg_zoom if arg_zoom else 2
tag = 1 if arg_tag_count and arg_tag_count > 0 else 0  # if label has a tag or not
tag_count = arg_tag_count if arg_tag_count else 0  # number of tags
description = arg_has_description if arg_has_description else 0  # if there's a description
clustered = 1 if cluster_count > 1 else 0  # if label is clustered
cluster_count = cluster_count if cluster_count > 1 else 0  # number of labels in that cluster
sidewalk_distance = 10  # sidewalk geometry from SDOT, feet -- EVERYTHING IS IN FEET
intersection_distance = dist_to_intersection  # 24  # distance to nearest intersection, feet
way_type = 'residential'

# Pass input data here
preprocessed_data = preprocess_model_input(severity, zoom, tag, tag_count, description, clustered, cluster_count, sidewalk_distance, intersection_distance, way_type)

# Result - Prediction
result = predict_model_seattle(session, model_input_name, model_output_name, preprocessed_data)
if DEBUG:
    print("Predictions:", result)
print(result[0][0])
