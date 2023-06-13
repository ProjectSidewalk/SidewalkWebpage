import requests
import pandas as pd
from pandas.io.json import json_normalize
import sys
import os
from shapely import wkb
from shapely.geometry import LineString

# Create CSV from street_edge table with street_edge_id, x1, y1, x2, y2, geom.
# Name it street_edge_endpoints.csv and put it in the root directory, then run this script.
# It will output a CSV called streets_with_no_imagery.csv. Use this to mark those edges as "deleted" in the database.

def write_output(no_imagery_df, curr_street):
    print # Adds newline after the progress percentage.

    # If we aren't done, save the last street we were working on at the end to keep track of our progress.
    if curr_street is not None:
        no_imagery_df = no_imagery_df.append({'street_edge_id': curr_street.street_edge_id, 'region_id': curr_street.region_id}, ignore_index=True)

    # Convert street_edge_id column from float to int.
    no_imagery_df.street_edge_id = no_imagery_df.street_edge_id.astype('int32')
    no_imagery_df.region_id = no_imagery_df.region_id.astype('int32')

    # Output both_endpoints_data and one_endpoint_data as CSVs.
    no_imagery_df.to_csv('streets_with_no_imagery.csv', index=False)

DISTANCE = 0.000135 # Approximately 15 meters in lat/lng. We don't need it to be super accurate here.
def redistribute_vertices(geom):
    # Add vertices to Linestring approximately every 15 meters. Adapted from an answer to this stackoverflow post:
    # https://stackoverflow.com/questions/34906124/interpolating-every-x-distance-along-multiline-in-shapely
    num_vert = int(round(geom.length / DISTANCE))
    if num_vert == 0:
        num_vert = 1
    return LineString([geom.interpolate(float(n) / num_vert, normalized=True) for n in range(num_vert + 1)])

if __name__ == '__main__':
    # Read google maps API key from env variable.
    api_key = os.getenv('GOOGLE_MAPS_API_KEY')
    if api_key is None:
        print("Couldn't read GOOGLE_MAPS_API_KEY environment variable.")
        exit(1)

    # Read street edge data from CSV.
    street_data = pd.read_csv('street_edge_endpoints.csv')
    street_data = street_data.sort_values(by=['region_id', 'street_edge_id'])
    n_streets = len(street_data)
    street_data['id'] = range(1, n_streets + 1)

    # Convert geom to Shapely format and add vertices approximately every 15 meters.
    street_data['geom'] = map(lambda g: redistribute_vertices(wkb.loads(g, hex=True)), street_data['geom'].values)

    # Create dataframe that will hold output data.
    streets_with_no_imagery = pd.DataFrame(columns=['street_edge_id', 'region_id'])

    # Get current progress and remove data we've already checked.
    if os.path.isfile('streets_with_no_imagery.csv'):
        streets_with_no_imagery = pd.read_csv('streets_with_no_imagery.csv')
        progress = streets_with_no_imagery.iloc[-1]['street_edge_id']
        progress_index = int(street_data[street_data.street_edge_id == progress]['id'])
        street_data = street_data[street_data.id >= progress_index]

        # Drop last row, which was only used to hold our current progress through the script.
        streets_with_no_imagery.drop(streets_with_no_imagery.tail(1).index, inplace=True)

    # Loop through the streets, adding any that are missing GSV imagery to streets_with_no_imagery.
    gsv_base_url = 'https://maps.googleapis.com/maps/api/streetview/metadata?source=outdoor&key=' + api_key
    gsv_url = gsv_base_url + '&radius=15'
    gsv_url_endpoint = gsv_base_url + '&radius=25'
    street_data = street_data.set_index('id')
    for index, street in street_data.iterrows():
        # Print a progress percentage.
        percent_complete = 100 * round(float(index) / n_streets, 4)
        sys.stdout.write("\r%.2f%% complete" % percent_complete)
        sys.stdout.flush()

        # Check endpoints first. If neither have imagery, we can say it has no imagery and move on.
        try:
            first_endpoint = requests.get(gsv_url_endpoint + '&location=' + str(street.y1) + ',' + str(street.x1))
            second_endpoint = requests.get(gsv_url_endpoint + '&location=' + str(street.y2) + ',' + str(street.x2))
        except (requests.exceptions.RequestException, KeyboardInterrupt) as e:
            write_output(streets_with_no_imagery, street)
            exit(1)
        first_endpoint_fail = json_normalize(first_endpoint.json()).status[0] == 'ZERO_RESULTS'
        second_endpoint_fail = json_normalize(second_endpoint.json()).status[0] == 'ZERO_RESULTS'

        # If no imagery at either endpoint, add to no imagery list and move on. If at least one has imagery, check many
        # points along the street for imagery to figure out whether or not most of the street is missing imagery.
        if first_endpoint_fail and second_endpoint_fail:
            streets_with_no_imagery = streets_with_no_imagery.append({'street_edge_id': street.street_edge_id, 'region_id': street.region_id}, ignore_index=True)
        else:
            n_success = 0
            n_fail = 0
            coords = list(street['geom'].coords)
            n_coord = len(coords)
            # Check for imagery every 15 meters along the street using a smaller radius than endpoints. We use 25 m for
            # the endpoints to guarantee we have a place for someone to start. Then we use 15 m at every point along the
            # street to ensure that we are not actually finding imagery for a nearby street.
            for coord in coords:
                try:
                    response = requests.get(gsv_url + '&location=' + str(coord[1]) + ',' + str(coord[0]))
                except (requests.exceptions.RequestException, KeyboardInterrupt) as e:
                    write_output(streets_with_no_imagery, street)
                    exit(1)
                response_status = json_normalize(response.json()).status[0]
                if response_status == 'ZERO_RESULTS':
                    n_fail += 1
                else:
                    n_success += 1

                # If there is no imagery on at least 50% of the street or if an endpoint is missing imagery and there is
                # no imagery on at least 25% of the street, add to streets_with_no_imagery. If at any point while
                # looping through the points we meet one of those criteria (or we find that we will not be able to meet
                # either criteria because there have already been enough points with imagery), we break out of the loop.
                if n_fail >= 0.5 * n_coord or (n_fail >= 0.25 * n_coord and (first_endpoint_fail or second_endpoint_fail)):
                    streets_with_no_imagery = streets_with_no_imagery.append({'street_edge_id': street.street_edge_id, 'region_id': street.region_id}, ignore_index=True)
                    break
                elif n_success > 0.75 * n_coord or (n_success > 0.5 * n_coord and not first_endpoint_fail and not second_endpoint_fail):
                    break

    write_output(streets_with_no_imagery, None)
