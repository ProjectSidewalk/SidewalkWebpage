import onnxruntime as rt
import numpy as np

# Function to preprocess the model input
def preprocess_model_input(severity, zoom, clustered, distance_to_road, distance_to_intersection, tag, description, label_type, way_type):
    # Combine the input features into a list
    data = [severity, zoom, clustered, distance_to_road, distance_to_intersection, tag, description]

    # Encode the label type as one-hot vector
    if label_type == 'CurbRamp':
        data += [1, 0, 0, 0, 0]
    elif label_type == 'NoCurbRamp':
        data += [0, 1, 0, 0, 0]
    elif label_type == 'NoSidewalk':
        data += [0, 0, 1, 0, 0]
    elif label_type == 'Obstacle':
        data += [0, 0, 0, 1, 0]
    elif label_type == 'SurfaceProblem':
        data += [0, 0, 0, 0, 1]
    else:
        data += [0, 0, 0, 0, 0]

    # Encode the way type as one-hot vector
    if way_type == 'living_street':
        data += [1, 0, 0, 0, 0, 0, 0]
    elif way_type == 'primary':
        data += [0, 1, 0, 0, 0, 0, 0]
    elif way_type == 'residential':
        data += [0, 0, 1, 0, 0, 0, 0]
    elif way_type == 'secondary':
        data += [0, 0, 0, 1, 0, 0, 0]
    elif way_type == 'tertiary':
        data += [0, 0, 0, 0, 1, 0, 0]
    elif way_type == 'trunk':
        data += [0, 0, 0, 0, 0, 1, 0]
    elif way_type == 'unclassified':
        data += [0, 0, 0, 0, 0, 0, 1]
    else:
        data += [0, 0, 0, 0, 0, 0, 0]

    # Convert the data list into a numpy array of type float32
    input_array = np.array([data], dtype=np.float32)
    # print("input_array type: " + str(type(input_array)))
    
    # Return the array
    return input_array


# Function to predict using the ONNX model
def predict_model_seattle(session, model_input_name, model_output_name, model_input):
    # Run the model
    output = session.run([model_output_name], {model_input_name: model_input})
    predictions = output[0]

    return predictions


# Load the ONNX model
onnx_path = "seattle_Prediction_MLP.onnx"
session = rt.InferenceSession(onnx_path)

# Get the input and output names for the model
model_input_name = session.get_inputs()[0].name
model_output_name = session.get_outputs()[0].name

# Test - example input data
severity = 5
zoom = 1
clustered = 1
distance_to_road = 18
distance_to_intersection = 0
tag = 1
description = 0
way_type = 'residential'
label_type = 'Obstacle'

# Pass input data to the preprocessing function
preprocessed_data = preprocess_model_input(severity, zoom, clustered, distance_to_road, distance_to_intersection, tag, description, label_type, way_type)

# Result - Prediction
result = predict_model_seattle(session, model_input_name, model_output_name, preprocessed_data)
print("Predictions:", result)
