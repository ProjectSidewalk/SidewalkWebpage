import requests
import pandas as pd
from pandas.io.json import json_normalize

# Create CSV from street_edge table with street_edge_id, x1, y1, x2, y2
# Name it street_edge_endpoints.csv and put it in the root directory, then run this script.
# It will output a CSV called streets_with_no_imagery.csv. Use this to mark those edges as "deleted" in the database.

if __name__ == '__main__':

    # Read google maps API key from file.
    try:
        with open("google_maps_api_key.txt", "r") as api_key_file:
            api_key = api_key_file.readline().strip()
    except IOError:
        print "Couldn't read google_maps_api_key.txt file"
        exit(1)

    # Read street edge data from CSV.
    street_data = pd.read_csv('street_edge_endpoints.csv')

    # Create dataframes that will hold output data.
    one_endpoint_data = pd.DataFrame(columns=['street_edge_id','problem_endpoint'])
    both_endpoints_data = pd.DataFrame(columns=['street_edge_id'])

    for index, street in street_data.iterrows():
        # Check if there is imagery at each endpoint
        gsv_url = 'https://maps.googleapis.com/maps/api/streetview/metadata?source=outdoor&radius=25&key=' + api_key
        first_endpoint = requests.get(gsv_url + '&location=' + str(street.y1) + ',' + str(street.x1))
        second_endpoint = requests.get(gsv_url + '&location=' + str(street.y2) + ',' + str(street.x2))

        first_endpoint_status = json_normalize(first_endpoint.json()).status[0]
        second_endpoint_status = json_normalize(second_endpoint.json()).status[0]

        # If there is no GSV data at either endpoint, add to both_endpoints_data. If only one endpoint is missing GSV
        # imagery, add to one_endpoint_data.
        if first_endpoint_status == 'ZERO_RESULTS' and second_endpoint_status == 'ZERO_RESULTS':
            both_endpoints_data = both_endpoints_data.append({'street_edge_id': street.street_edge_id}, ignore_index=True)
        elif first_endpoint_status == 'ZERO_RESULTS':
            one_endpoint_data = one_endpoint_data.append({'street_edge_id': street.street_edge_id, 'problem_endpoint': 1}, ignore_index=True)
        elif second_endpoint_status == 'ZERO_RESULTS':
            one_endpoint_data = one_endpoint_data.append({'street_edge_id': street.street_edge_id, 'problem_endpoint': 2}, ignore_index=True)

    # Convert street_edge_id columns from float to int.
    one_endpoint_data.street_edge_id = one_endpoint_data.street_edge_id.astype('int32')
    one_endpoint_data.problem_endpoint = one_endpoint_data.problem_endpoint.astype('int32')
    both_endpoints_data.street_edge_id = both_endpoints_data.street_edge_id.astype('int32')

    # Output both_endpoints_data and one_endpoint_data as CSVs.
    one_endpoint_data.to_csv('streets_with_partial_imagery.csv', index=False)
    both_endpoints_data.to_csv('streets_with_no_imagery.csv', index=False)
