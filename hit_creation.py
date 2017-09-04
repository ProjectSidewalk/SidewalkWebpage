from connect import *

import psycopg2.extras
from datetime import datetime
from datetime import timedelta
import pandas as pd
from pprint import pprint


'''
Create missions for the routes if they don't exist
'''


def create_missions_for_routes(engine, cursor, route_rows):

    # Get all the current route_id in  sidewalk.route
    cursor.execute("""SELECT * from sidewalk.mission where label = 'mturk-mission'""")
    mturk_mission_rows = cursor.fetchall()
    db_region_id_list = map(lambda x: x["region_id"], mturk_mission_rows)
    route_region_id_list = map(lambda x: x["region_id"], route_rows)

    mission_rows_to_insert = []
    db_inserted_region_id_list = []
    for region_id in route_region_id_list:
        if (region_id not in db_region_id_list and
                region_id not in db_inserted_region_id_list):
            # Insert into mission table
            mission_rows_to_insert.append({
                'region_id': region_id,
                'label': 'mturk-mission',
                'level': 1,
                'deleted': False,
                'coverage': None,
                'distance': 304.8,
                'distance_ft': 1000,
                'distance_mi': 0.189394
            })
            mission_rows_to_insert.append({
                'region_id': region_id,
                'label': 'mturk-mission',
                'level': 2,
                'deleted': False,
                'coverage': None,
                'distance': 609.6,
                'distance_ft': 2000,
                'distance_mi': 0.378788
            })
            mission_rows_to_insert.append({
                'region_id': region_id,
                'label': 'mturk-mission',
                'level': 3,
                'deleted': False,
                'coverage': None,
                'distance': 1219.2,
                'distance_ft': 4000,
                'distance_mi': 0.757576
            })
            db_inserted_region_id_list.append(region_id)
            print "Mission created for region", region_id

    mission_table_df = pd.DataFrame(mission_rows_to_insert)
    mission_table_df.to_sql('mission', engine, if_exists='append', index=False)

'''
This is the main HIT generation function. We just need to specify the number of HIT assignments 
i.e. number of people who will need to work on the routes. The turkers will be assigned to each condition
in a round robin fashion. The function doesnt explicitly create a HIT for each condition since, as mentioned
previously, the assignment of turkers to conditions is handled by the sidewalk-mturk server on the "\" endpoint.
'''

def create_hits(number_of_assignments = 1):
    # HIT Parameters

    title = "Help us find and label sidewalk problems in Washington DC"

    description = "In this task, you will virtually walk through city streets " + \
    "in Washington DC to find and label accessibility features (e.g., " + \
    "curb ramps) and problems (e.g., degraded sidewalks, missing curb ramps) " + \
    "using our custom tool called Project Sidewalk."

    keywords = "Accessibility, Americans with Disabilities, Wheelchairs, Image Labeling,"
    " Games, Mobility Impairments, Smart Cities"
    frame_height = 800  # the height of the iframe holding the external hit
    amount = '0.0'

    # Get mturk client
    mturk = connect_to_mturk()

    t_before_creation = datetime.now()

    # The external question object allows you to view an external url inside an iframe
    # mTurk automatically appends worker and hit variables to the external url
    # Variable passed to the external url are workerid, assignmentid, hitid, ...
    # Once the task is successfully completed the external server needs to
    # perform a POST operation to an mturk url
    url = 'https://sidewalk-mturk.umiacs.umd.edu/'
    external_question = '<ExternalQuestion xmlns = "http://mechanicalturk.amazonaws.com/AWSMechanicalTurkDataSchemas/2006-07-14/ExternalQuestion.xsd">' + \
        '<ExternalURL>' + url + '</ExternalURL><FrameHeight>' + \
        str(frame_height) + '</FrameHeight></ExternalQuestion>'


    # Create a sample HIT that expires after an 'LifetimeInSeconds'

    mturk.create_hit(
        Title=title,
        LifetimeInSeconds=86400,
        AssignmentDurationInSeconds=7200,
        MaxAssignments=number_of_assignments,
        Description=description,
        Keywords=keywords,
        Question=external_question,
        Reward=amount,
        RequesterAnnotation=str(t_before_creation)
    )
    print "HIT created with ", number_of_assignments, " assignments."


if __name__ == '__main__':

    try:
        # Connect to PostgreSQL database
        conn, engine = connect_to_db()

        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Get all the current condition_ids in  sidewalk.amt_condition
        number_of_assignments = 1

        create_hits(number_of_assignments)

        # Get all the current route_ids in  sidewalk.route
        cur.execute(
            """SELECT route_id, region_id from sidewalk.route order by street_count desc""")
        route_rows = cur.fetchall()
        # Insert into Mission Table - create new mission for a route (if it doesn't exist)
        create_missions_for_routes(engine, cur, route_rows)

    except Exception as e:
        print "Error: ", e