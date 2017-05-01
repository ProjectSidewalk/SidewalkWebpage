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

url = 'https://sidewalk-mturk.umiacs.umd.edu' #'https://httpbin.org/response-headers?'
title = "[TESTHIT] University of Maryland: Help make our sidewalks more accessible for wheelchair users with Google Maps"

description = "Please help us improve the accessibility of our cities for wheelchair users. In this task, you will " \
              "virtually walk through city streets in Washington DC to find and label accessibility features (e.g., " \
              "curb ramps) and problems (e.g., degraded sidewalks, missing curb ramps) using our custom tool " \
              "called Project Sidewalk."

keywords = "Accessibility, Americans with Disabilities, Wheelchairs, Image Labeling, Games, Mobility Impairments, Smart Cities"
frame_height = 1000 # the height of the iframe holding the external hit
amount = 0.0

# The external question object allows you to view an external url inside an iframe
# mTurk automatically appends worker and hit variables to the external url
# Variable passed to the external url are workerid, assignmentid, hitid, ...
# Once the task is successfully completed the external server needs to perform a POST operation to an mturk url
external_question = '<ExternalQuestion xmlns="http://mechanicalturk.amazonaws.com/AWSMechanicalTurkDataSchemas/2006-07-14/ExternalQuestion.xsd">'+ '<ExternalURL>'+url+'</ExternalURL><FrameHeight>' + str(frame_height) + '</FrameHeight></ExternalQuestion>'

# Create a sample HIT that expires after an 'LifetimeInSeconds'

mturk.create_hit(
    Title = title,
    LifetimeInSeconds = 600,
    AssignmentDurationInSeconds = 3600,
    MaxAssignments = 10,
    Description = description,
    Keywords = keywords,
    Question = external_question,
    Reward = '0.1',
)
