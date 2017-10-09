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

    # Get the list of all missions completed by non-researcher turkers excluding onboarding and their first 500ft mission
    # Filter out the missions that were already rewarded with a bonus in a previous run of this program. 
    # (These can be stored as an additional column in the mission_user_table)
    # Calculate the distance associated with the completed unpaid missions
    # Calculate bonus amount based on distance audited
    # Use the boto function award a bonus to that user. 
    #(Find the same user in the amt_assignment table and get the hit id and assignment id for this)

    mission_df = pd.DataFrame.from_csv('../test_bonus_payment.csv')

    user_grouped = mission_df.sort_values('mission_user_id').groupby('username')

    mturk = connect_to_mturk()

    pay_per_mile = 4.17 #Need to set this
    send_bonuses = False # Change to True to allow bonuses to be sent

    for username,user_group in user_grouped:
        print "username: ",username
        first_mission_user_id = user_group.reset_index(drop=True)[0:1]['mission_user_id'][0]
        region_grouped = pd.DataFrame(user_group).reset_index(drop=True).groupby('region_id')
        for region_id, region_group in region_grouped:
            print "region_id: ",region_id
            region_df = pd.DataFrame(region_group).reset_index(drop=True)
            region_df['mission_distance'] = region_df['distance_mi'].diff()
            region_df_to_be_paid = region_df[(region_df['mission_distance']>0) & (region_df['paid']==False)]
            region_df_ignored = pd.DataFrame(region_df[(region_df['mission_distance']<=0) & (region_df['paid']==False)])

            # The first mission in the region will have a mission_distance of Nan because of the diff() function. 
            # We need to check if this was the user's first mission ever and also if it was already paid for
            # Else we need to include it in our list of missions to be paid for.
            if(region_df[0:1]['mission_user_id'][0] != first_mission_user_id and region_df[0:1]['paid'][0]==False):
                region_df[0:1]['mission_distance'][0] = region_df['distance_mi'][0]
                region_df_to_be_paid=region_df_to_be_paid.append(region_df[0:1])

            for idx,row in region_df_to_be_paid.iterrows():
                bonus = round(pay_per_mile * row['mission_distance'],2)
                # Call mturk boto3 function to assign a bonus to the worker using the assignment id
                reason = "Bonus of $" + "%.2f" % bonus + " paid for completing a "+str(row['mission_distance'])+" mile long mission on project sidewalk"
                
                if(send_bonuses):
                    response = mturk.send_bonus(WorkerId=row['username'],BonusAmount="%.2f" % bonus,
                        AssignmentId=row['assignment_id'],Reason=reason,
                        UniqueRequestToken=row['username']+row['assignment_id']+row['mission_user_id'])
                
                print reason
                # print response
                # Update the paid column for the mission_user_id row on the mission_user table to True
                if(send_bonuses):
                    cur.execute("UPDATE sidewalk.mission_user SET paid=true WHERE sidewalk.mission_user.mission_user_id="+str(row['mission_user_id'])+";")
                    conn.commit()

            for idx, row in region_df_ignored.iterrows():
                if(send_bonuses):
                    cur.execute("UPDATE sidewalk.mission_user SET paid=true WHERE sidewalk.mission_user.mission_user_id="+str(row['mission_user_id'])+";")
                    conn.commit()

    cur.close()
    
except Exception as e:
    print "Error: ", e

