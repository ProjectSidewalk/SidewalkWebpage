import onnxruntime as rt
import numpy as np
# import geopandas as gpd

# TODO add clustering
# TODO add sidewalk geometry
# TODO add intersection detection
# TODO set up a way to call this from PS server with relevant inputs

def preprocess_model_input (severity, zoom, tag, tag_count, description, clustered, cluster_count, sidewalk_distance, intersection_distance, way_type):

    data = [severity, zoom, clustered, cluster_count, sidewalk_distance, tag, description, tag_count, intersection_distance]
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
    print(data)

    input_array = np.array(data, dtype=np.float32)
    print(input_array)
    input_array = input_array.reshape((1, input_array.shape[0]))
    print(input_array)
    
    # Return the array
    return input_array

def predict_model_seattle(session, model_input_name, model_output_name, model_input):
    # Run model

    output = session.run([model_output_name], {model_input_name: model_input})
    predictions = output[0]

    return predictions

# labels_to_cluster = gpd.read_file('q1.shp')

# Load the ONNX model
onnx_path = "predictionModel.onnx"
session = rt.InferenceSession(onnx_path)

model_input_name = session.get_inputs()[0].name
model_output_name = session.get_outputs()[0].name

# Test - example input data
severity = 2
zoom = 2
tag = 1 # if label has a tag or not
tag_count = 2
description = 1 # if there's a description
clustered = 1 # if it was clustered -- can just do clustering eveyr time in a small radius and then throw it away
cluster_count = 5 # number of labels in that cluster
sidewalk_distance = 100 # sidewalk geometry from SDOT, feet -- EVERYTHING IS IN FEET
intersection_distance = 100
way_type = '-1'

# Pass input data here
preprocessed_data = preprocess_model_input(severity, zoom, tag, tag_count, description, clustered, cluster_count, sidewalk_distance, intersection_distance, way_type)

# Result - Prediction
result = predict_model_seattle(session, model_input_name, model_output_name, preprocessed_data)
print("Predictions:", result)