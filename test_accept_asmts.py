import boto3

# Get key from an external file
secret_key = {}
with open("rootkey.csv") as myfile:
    for line in myfile:
        name, var = line.partition("=")[::2]
        secret_key[name.strip()] = str(var.strip())

# Setup mTurk parameters
sandbox_host = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com/'
real_host = 'mechanicalturk.amazonaws.com'
region_name = 'us-east-1'
aws_access_key_id = secret_key["AWSAccessKeyId"] #'AKIAIPS3ET7RWBOY7RDQ'
aws_secret_access_key = secret_key["AWSSecretKey"] #'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'

mturk = boto3.client('mturk',
                     endpoint_url = sandbox_host,
                     region_name = region_name,
                     aws_access_key_id = aws_access_key_id,
                     aws_secret_access_key = aws_secret_access_key,
                     )

print mturk.get_account_balance()['AvailableBalance'] # Sample line of code to get account balance [$10,000.00]

# list_reviewable_hits() gets all HITs that are ready to be reviewed from Amazon, stored in a dict.
# Each HIT is assigned to multiple (5) turkers, so we call list_assignments_for_hit() to get those
# assignments using the HIT ID. We can then approve/reject each assignment using it's ID. When we
# call approve_assignment(AsmtID), the turker is automatically paid and MTurk fees are debited. See
# the following for API reference and python bindings, respectively.
# http://docs.aws.amazon.com/AWSMechTurk/latest/AWSMturkAPI/ApiReference_OperationsArticle.html
# https://boto3.readthedocs.io/en/latest/reference/services/mturk.html
hits_to_review = mturk.list_reviewable_hits()
for hit in hits_to_review['HITs']:
    asmts_to_review = mturk.list_assignments_for_hit(hit['HITId'])
    for asmt in asmts_to_review['Assignments']:
        mturk.approve_assignment(asmt['AssignmentID'])

