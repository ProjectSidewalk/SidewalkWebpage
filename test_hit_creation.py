import boto3

sandbox_host = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com/'
real_host = 'mechanicalturk.amazonaws.com'
region_name = 'us-east-1'
aws_access_key_id = ''
aws_secret_access_key = ''

mturk = boto3.client('mturk',
                     endpoint_url = sandbox_host,
                     region_name = region_name,
                     aws_access_key_id = aws_access_key_id,
                     aws_secret_access_key = aws_secret_access_key,
                     )

print mturk.get_account_balance()['AvailableBalance'] # Sample line of code to get account balance [$10,000.00]

url = 'https://sidewalk.umiacs.umd.edu/audit?' #'https://httpbin.org/response-headers?'
title = "A test hit"
description = "Description"
keywords = "yes,no,test,why"
frame_height = 1000 # the height of the iframe holding the external hit
amount = 0.0

# The external question object allows you to view an external url inside an iframe 
# Variable passed to the external url are workerid, assignmentid, hitid, ...
# Once the task is successfully completed the external server needs to perform a POST operation to an mturk url (not included here)
external_question = '<ExternalQuestion xmlns="http://mechanicalturk.amazonaws.com/AWSMechanicalTurkDataSchemas/2006-07-14/ExternalQuestion.xsd">'
+ '<ExternalURL>'+url+'</ExternalURL><FrameHeight>' + frame_height + '</FrameHeight></ExternalQuestion>'

#Create a sample HIT that expires after an hour
#mturk automatically appends worker and hit variables to the external url
#httpbin.org/response-headers is a test server that displays the query object (key value pairs) passed to it in the url

mturk.create_hit(
    Title = title,
    LifetimeInSeconds = 3600,
    AssignmentDurationInSeconds = 3600,
    MaxAssignments = 10,
    Description = description,
    Keywords = keywords,
    Question = external_question,
    Reward = '0.0',
)