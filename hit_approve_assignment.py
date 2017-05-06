from connect_to_mturk import connect_to_mturk
from pprint import pprint
import time
import pandas as pd

mturk = connect_to_mturk()

# all newly approved assignments will be added to this dataframe, then written out to a csv
csv_cols = ['HITId','AssignmentId','WorkerId','AssignmentStatus','AcceptTime','SubmitTime']
new_approvals = pd.DataFrame(columns=csv_cols)
i = 0

'''
list_reviewable_hits() gets all HITs that are ready to be reviewed from Amazon, stored in a dict.
Each HIT is assigned to multiple (5) turkers, so we call list_assignments_for_hit() to get those
assignments using the HIT ID. We can then approve/reject each assignment using it's ID. When we
call approve_assignment(AsmtID), the turker is automatically paid and MTurk fees are debited.

See the following for API reference and python bindings, respectively.
http://docs.aws.amazon.com/AWSMechTurk/latest/AWSMturkAPI/ApiReference_OperationsArticle.html
https://boto3.readthedocs.io/en/latest/reference/services/mturk.html
'''
hits_to_review = mturk.list_reviewable_hits()

for hit in hits_to_review['HITs']:
    asmts_to_review = mturk.list_assignments_for_hit(HITId=hit['HITId'], AssignmentStatuses=['Submitted'])
    for asmt in asmts_to_review['Assignments']:
    	print 'Approving the following assignment:'
    	pprint(asmt); print
        mturk.approve_assignment(AssignmentId=asmt['AssignmentId'])

        # add approved assignment info to a CSV
        new_row = [asmt['HITId'], asmt['AssignmentId'], asmt['WorkerId'], asmt['AssignmentStatus'],
        		   str(asmt['AcceptTime']), str(asmt['SubmitTime'])]
    	new_approvals.loc[i] = new_row
    	i += 1

# write to a CSV 
new_approvals.to_csv('mturk_results/' + time.strftime("results_%d-%m-%Y_%H:%M:%S") + '.csv', index=False)
