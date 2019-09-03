import requests
import pandas as pd
from pandas.io.json import json_normalize
import sys

# Create CSV from street_edge table with street_edge_id, x1, y1, x2, y2
# Name it street_edge_endpoints.csv and put it in the scripts/ directory, then run this script.
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

    # Create dataframe that will hold output data.
    streets_with_no_imagery = pd.DataFrame(columns=['street_edge_id'])

    n_rows = len(street_data)
    for index, street in street_data.iterrows():
        # Print a progress percentage.
        percent_complete = 100 * round(float(index + 1) / n_rows, 3)
        sys.stdout.write("\r%.1f%% complete" % percent_complete)
        sys.stdout.flush()

        # Check if there is imagery at each endpoint
        gsv_url = 'https://maps.googleapis.com/maps/api/streetview/metadata?source=outdoor&radius=25&key=' + api_key
        first_endpoint = requests.get(gsv_url + '&location=' + str(street.y1) + ',' + str(street.x1))
        second_endpoint = requests.get(gsv_url + '&location=' + str(street.y2) + ',' + str(street.x2))

        first_endpoint_status = json_normalize(first_endpoint.json()).status[0]
        second_endpoint_status = json_normalize(second_endpoint.json()).status[0]

        # If there is no GSV data at either endpoint, add to streets_with_no_imagery.
        if first_endpoint_status == 'ZERO_RESULTS' or second_endpoint_status == 'ZERO_RESULTS':
            streets_with_no_imagery = streets_with_no_imagery.append({'street_edge_id': street.street_edge_id}, ignore_index=True)
    print # Adds newline after the progress percentage.

    # Convert street_edge_id column from float to int.
    streets_with_no_imagery.street_edge_id = streets_with_no_imagery.street_edge_id.astype('int32')

    # Output both_endpoints_data and one_endpoint_data as CSVs.
    streets_with_no_imagery.to_csv('streets_with_no_imagery.csv', index=False)
