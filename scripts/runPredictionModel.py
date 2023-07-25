import onnxruntime as rt
import numpy as np
import argparse
# import geopandas as gpd

# TODO add clustering
# TODO add sidewalk geometry
# TODO add intersection detection
# TODO set up a way to call this from PS server with relevant inputs

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
LABEL_TYPE = args.label_type
ZOOM = args.zoom
SEVERITY = args.severity
HAS_DESCRIPTION = args.has_description
TAG_COUNT = args.tag_count
LAT = args.lat
LNG = args.lng
DEBUG = args.debug

if DEBUG:
    print(LABEL_TYPE)
    print(ZOOM)
    print(SEVERITY)
    print(HAS_DESCRIPTION)
    print(TAG_COUNT)
    print(LAT)
    print(LNG)

# labels_to_cluster = gpd.read_file('q1.shp')

# Load the ONNX model
onnx_path = "scripts/predictionModel.onnx"
session = rt.InferenceSession(onnx_path)

model_input_name = session.get_inputs()[0].name
model_output_name = session.get_outputs()[0].name

# Test - example input data
severity = SEVERITY if SEVERITY else 0
zoom = ZOOM if ZOOM else 2
tag = 1 if TAG_COUNT and TAG_COUNT > 0 else 0 # if label has a tag or not
tag_count = TAG_COUNT if TAG_COUNT else 0 # number of tags
description = HAS_DESCRIPTION if HAS_DESCRIPTION else 0 # if there's a description
clustered = 0 # if it was clustered -- can just do clustering every time in a small radius and then throw it away
cluster_count = 0 # number of labels in that cluster
sidewalk_distance = 10 # sidewalk geometry from SDOT, feet -- EVERYTHING IS IN FEET
intersection_distance = 24
way_type = 'residential'

# Pass input data here
preprocessed_data = preprocess_model_input(severity, zoom, tag, tag_count, description, clustered, cluster_count, sidewalk_distance, intersection_distance, way_type)

# Result - Prediction
result = predict_model_seattle(session, model_input_name, model_output_name, preprocessed_data)
if DEBUG:
    print("Predictions:", result)
print(result[0][0])
