from connect_to_mturk import connect_to_mturk

mturk = connect_to_mturk()

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
    asmts_to_review = mturk.list_assignments_for_hit(hit['HITId'])
    for asmt in asmts_to_review['Assignments']:
        mturk.approve_assignment(asmt['AssignmentID'])
