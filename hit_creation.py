from connect_to_mturk import connect_to_mturk

import psycopg2
import psycopg2.extras
from sqlalchemy import create_engine

from datetime import datetime
from datetime import timedelta
import pandas as pd
from pprint import pprint

'''
    Assign routes to the newly created HITs.
    The RequesterAnnotation attribute of the HIT stores the associated route_id
'''
def assign_routes_to_hits(mturk, engine, routes, t_before_creation):

    hit_route_map = []

    # Returns a page of 100 HITs. Seem to be in chronological order.
    response = mturk.list_hits(MaxResults=100)
    all_hits = response['HITs']
    if('NextToken' in response):
        next_token = response['NextToken']
        num_results = response['NumResults']
        while(int(num_results)>0):
            #Use the pagination token NextToken to get the next 100 HITs till there are no more.
            response = mturk.list_hits(MaxResults=100,NextToken=next_token)
            num_results = response['NumResults']
            for hit in response['HITs']:
                all_hits.append(hit)
            if('NextToken' in response):
                next_token = response['NextToken']

    print "Total HITs:", len(all_hits)

    for hit in all_hits:
        pprint(hit)
        print hit['CreationTime']
        print t_before_creation
        # Fixed: hit creation time provided by the mturk API has local time info. t_before_creation doesnt. 
        # Check for Hits created after t_before_creation
        # You dont want HITs created a half an hour back if they also have route ids.
        # Even if the incorrect ones get overwritten. I've still given you the option to set that (currently at 1 minute).
        if hit['CreationTime'].replace(tzinfo=None) > (t_before_creation - timedelta(minutes=1)):
            if 'RequesterAnnotation' in hit:
                route_id = int(hit['RequesterAnnotation'])
                if route_id in routes:
                    hit_route_map.append({'hit_id': hit['HITId'], 'route_id': route_id})

    hit_route_df = pd.DataFrame(hit_route_map)
    hit_route_df.to_sql('amt_route_assignment', engine, if_exists='append', index=False)


if __name__ == '__main__':

    # HIT Parameters
    url = 'https://sidewalk-mturk.umiacs.umd.edu'
    title = "[TESTHIT] University of Maryland: Help make our sidewalks more"
    " accessible for wheelchair users with Google Maps"

    description = "Please help us improve the accessibility of our cities for "
    "wheelchair users. In this task, you will virtually walk through city streets "
    "in Washington DC to find and label accessibility features (e.g., "
    "curb ramps) and problems (e.g., degraded sidewalks, missing curb ramps) "
    "using our custom tool called Project Sidewalk."

    keywords = "Accessibility, Americans with Disabilities, Wheelchairs, Image Labeling,"
    " Games, Mobility Impairments, Smart Cities"
    frame_height = 800  # the height of the iframe holding the external hit
    amount = 0.0

    # The external question object allows you to view an external url inside an iframe
    # mTurk automatically appends worker and hit variables to the external url
    # Variable passed to the external url are workerid, assignmentid, hitid, ...
    # Once the task is successfully completed the external server needs to
    # perform a POST operation to an mturk url
    external_question = '<ExternalQuestion xmlns = "http://mechanicalturk.amazonaws.com/AWSMechanicalTurkDataSchemas/2006-07-14/ExternalQuestion.xsd">' + \
                        '<ExternalURL>' + url + '</ExternalURL><FrameHeight>' + \
                        str(frame_height) + '</FrameHeight></ExternalQuestion>'

    # Get mturk client
    mturk = connect_to_mturk()

    # Connect to PostgreSQL database
    db_port = '5432'
    try:
        conn = psycopg2.connect(
            "dbname='sidewalk' user='sidewalk' host='localhost' port=" + db_port +
            " password='sidewalk'")
        engine = create_engine(
            'postgresql://sidewalk:sidewalk@localhost:' + db_port + '/sidewalk')

        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Get all the current route_id s in  sidewalk.route
        cur.execute("""SELECT route_id from sidewalk.route""")
        rows = cur.fetchall()
        routes = map(lambda x: x["route_id"], rows)

        t_before_creation = datetime.now()
        number_of_routes = 5

        for route in routes[0: min(number_of_routes, len(routes))]:
            # Create a sample HIT that expires after an 'LifetimeInSeconds'

            mturk.create_hit(
                Title=title,
                LifetimeInSeconds=600,
                AssignmentDurationInSeconds=3600,
                MaxAssignments=5,
                Description=description,
                Keywords=keywords,
                Question=external_question,
                Reward='0.1',
                RequesterAnnotation=str(route)
            )
            print "HIT for route", route, "created"

        # Get the list of HITs created, assign routes to HITs
        assign_routes_to_hits(mturk, engine, routes, t_before_creation)
    except Exception as e:
        print "Error: ", e
