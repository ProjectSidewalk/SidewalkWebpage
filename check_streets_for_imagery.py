import requests
import pandas as pd
from pandas.io.json import json_normalize
import sys
import os.path

# Create CSV from street_edge table with street_edge_id, x1, y1, x2, y2
# Name it street_edge_endpoints.csv and put it in the root directory, then run this script.
# It will output a CSV called streets_with_no_imagery.csv. Use this to mark those edges as "deleted" in the database.

def write_output():
    print # Adds newline after the progress percentage.
    # Convert street_edge_id column from float to int.
    streets_with_no_imagery.street_edge_id = streets_with_no_imagery.street_edge_id.astype('int32')
    streets_with_no_imagery.region_id = streets_with_no_imagery.region_id.astype('int32')

    # Output both_endpoints_data and one_endpoint_data as CSVs.
    streets_with_no_imagery.to_csv('streets_with_no_imagery.csv', mode='a', header=incl_headers, index=False)


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
    street_data = street_data.sort_values(by=['region_id', 'street_edge_id'])
    n_streets = len(street_data)
    street_data['id'] = range(1, n_streets + 1)

    # Create dataframe that will hold output data.
    streets_with_no_imagery = pd.DataFrame(columns=['street_edge_id', 'region_id'])

    # Get current progress and remove data we've already checked.
    incl_headers = True
    if os.path.isfile('streets_with_no_imagery.csv'):
        no_imagery_progress_data = pd.read_csv('streets_with_no_imagery.csv')
        progress = no_imagery_progress_data.iloc[-1]['street_edge_id']
        progress_index = int(street_data[street_data.street_edge_id == progress]['id'])
        street_data = street_data[street_data.id > progress_index]
        incl_headers = False

    street_data = street_data.set_index('id')
    for index, street in street_data.iterrows():
        # Print a progress percentage.
        percent_complete = 100 * round(float(index) / n_streets, 4)
        sys.stdout.write("\r%.2f%% complete" % percent_complete)
        sys.stdout.flush()

        # Check if there is imagery at each endpoint.
        gsv_url = 'https://maps.googleapis.com/maps/api/streetview/metadata?source=outdoor&radius=25&key=' + api_key
        try:
            first_endpoint = requests.get(gsv_url + '&location=' + str(street.y1) + ',' + str(street.x1))
            second_endpoint = requests.get(gsv_url + '&location=' + str(street.y2) + ',' + str(street.x2))
        except (requests.exceptions.RequestException, KeyboardInterrupt) as e:
            write_output()
            print e
            exit(1)

        first_endpoint_status = json_normalize(first_endpoint.json()).status[0]
        second_endpoint_status = json_normalize(second_endpoint.json()).status[0]

        # If there is no GSV data at either endpoint, add to streets_with_no_imagery.
        if first_endpoint_status == 'ZERO_RESULTS' or second_endpoint_status == 'ZERO_RESULTS':
            streets_with_no_imagery = streets_with_no_imagery.append({'street_edge_id': street.street_edge_id, 'region_id': street.region_id}, ignore_index=True)

    write_output()
