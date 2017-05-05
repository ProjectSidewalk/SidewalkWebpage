from connect_to_mturk import connect_to_mturk

mturk = connect_to_mturk()

# TODO:
'''
Assign routes to the newly created HITs
'''
def assign_routes_to_hits():
    pass

url = 'https://sidewalk-mturk.umiacs.umd.edu'
title = "[TESTHIT] University of Maryland: Help make our sidewalks more accessible for wheelchair users with Google Maps"

description = "Please help us improve the accessibility of our cities for wheelchair users. In this task, you will " \
              "virtually walk through city streets in Washington DC to find and label accessibility features (e.g., " \
              "curb ramps) and problems (e.g., degraded sidewalks, missing curb ramps) using our custom tool " \
              "called Project Sidewalk."

keywords = "Accessibility, Americans with Disabilities, Wheelchairs, Image Labeling, Games, Mobility Impairments, Smart Cities"
frame_height = 1000  # the height of the iframe holding the external hit
amount = 0.0

# The external question object allows you to view an external url inside an iframe
# mTurk automatically appends worker and hit variables to the external url
# Variable passed to the external url are workerid, assignmentid, hitid, ...
# Once the task is successfully completed the external server needs to
# perform a POST operation to an mturk url
external_question = '<ExternalQuestion xmlns="http://mechanicalturk.amazonaws.com/AWSMechanicalTurkDataSchemas/2006-07-14/ExternalQuestion.xsd">' + \
    '<ExternalURL>' + url + '</ExternalURL><FrameHeight>' + \
    str(frame_height) + '</FrameHeight></ExternalQuestion>'

# Create a sample HIT that expires after an 'LifetimeInSeconds'

mturk.create_hit(
    Title=title,
    LifetimeInSeconds=600,
    AssignmentDurationInSeconds=3600,
    MaxAssignments=10,
    Description=description,
    Keywords=keywords,
    Question=external_question,
    Reward='0.1',
)

# TODO: Get the list of HITs created, assign routes to HITs
assign_routes_to_hits()