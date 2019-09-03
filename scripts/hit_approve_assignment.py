from connect import *

import psycopg2.extras
from datetime import datetime
from datetime import timedelta

import os
import time
import pandas as pd
from pprint import pprint

try:
    # Connect to PostgreSQL database
    conn, engine = connect_to_db()

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Get the list of all MTurk assignments and confirmation codes from the amt_assignment table here
    cur.execute("""SELECT hit_id, assignment_id, turker_id, confirmation_code from sidewalk.amt_assignment""")
    amt_assignment_rows = cur.fetchall()
    existing_hits = map(lambda x: x["hit_id"], amt_assignment_rows)

    existing_assignments_dict = { x["assignment_id"]:x for x in amt_assignment_rows}

    mturk = connect_to_mturk()

    # all newly approved assignments will be added to this dataframe, then
    # written out to a csv
    csv_cols = ['HITId','AssignmentId', 'WorkerId',
                'AssignmentStatus', 'Answer', 'AcceptTime', 'SubmitTime']
    new_approvals = pd.DataFrame(columns=csv_cols)
    i = 0
    
    '''
    list_reviewable_hits() gets all HITs that are ready to be reviewed from Amazon, stored in a dict.
    We call list_assignments_for_hit() to get those assignments using the HIT ID. 
    We can then approve/reject each assignment depending on whether it is present in the amt_assignment table 
    and if the user has submitted the correct confirmation code. When we
    call approve_assignment(AsmtID), the turker is automatically paid and MTurk fees are debited.
    
    See the following for API reference and python bindings, respectively.
    http://docs.aws.amazon.com/AWSMechTurk/latest/AWSMturkAPI/ApiReference_OperationsArticle.html
    https://boto3.readthedocs.io/en/latest/reference/services/mturk.html
    '''

    hits_to_review = mturk.list_reviewable_hits()
    relevant_hits_to_review = [hit for hit in hits_to_review['HITs'] if hit['HITId'] in existing_hits]

    if len(relevant_hits_to_review) == 0:
        print "No relevant HITs to review"
    else:
        print "HITs to review: "
        print relevant_hits_to_review
    
    for hit in relevant_hits_to_review:
        asmts_to_review = mturk.list_assignments_for_hit(
            HITId=hit['HITId'], AssignmentStatuses=['Submitted'])

        for asmt in asmts_to_review['Assignments']:
            generated_confirmation_code = existing_assignments_dict[asmt['AssignmentId']]['confirmation_code']
            code_submitted_matches = "<FreeText>"+generated_confirmation_code+"</FreeText>" in asmt['Answer']
            worker_id_matches = existing_assignments_dict[asmt['AssignmentId']]['turker_id'] == asmt['WorkerId'] # This isnt actually required

            if(code_submitted_matches and worker_id_matches):
                print 'Approving the following assignment:'
                pprint(asmt)
                print
                mturk.approve_assignment(AssignmentId=asmt['AssignmentId'])

                # add approved assignment info to a CSV
                new_row = [asmt['HITId'], asmt['AssignmentId'], asmt['WorkerId'],
                        asmt['AssignmentStatus'], asmt['Answer'], str(asmt['AcceptTime']),
                        str(asmt['SubmitTime'])]
                new_approvals.loc[i] = new_row
                i += 1
            else:
                print 'Not approving the following assignment:'
                pprint(asmt)

    directory = 'mturk_results/'
    if not os.path.exists(directory):
        os.makedirs(directory)
    
    # write to a csv
    new_approvals.to_csv(directory + time.strftime("results_%d-%m-%Y_%H-%M-%S") + '.csv', index=False)
except Exception as e:
    print "Error: ", e

